import { type PublicClient } from "viem";
import { OnchainosClient } from "./onchainos.js";
import { UniswapAIClient, type UniswapRouteResult } from "./uniswap.js";
import { PlanSigner, planNonce } from "./signer.js";
import { createChainClient, getErc20Balance, getErc20Allowance } from "./chain.js";
import {
  IntentSchema,
  RiskLimitsSchema,
  type CheckResult,
  type Intent,
  type PreflightConfig,
  type RiskLimits,
  type ReasonCodeKey,
  type VerifiedPlan,
  type VerifyResponse,
  X_LAYER_CHAIN_ID,
} from "./types.js";

const PLAN_TTL_MS = 90_000;
const CROSS_SOURCE_TOLERANCE_BPS = 50;

export class Preflight {
  private readonly okx: OnchainosClient;
  private readonly uni: UniswapAIClient;
  private readonly signer: PlanSigner;
  private readonly chain: PublicClient;

  constructor(private readonly cfg: PreflightConfig) {
    this.okx = new OnchainosClient({
      apiKey: cfg.onchainosApiKey,
      secretKey: cfg.onchainosSecretKey,
      passphrase: cfg.onchainosPassphrase,
      ...(cfg.okxBaseUrl !== undefined && { baseUrl: cfg.okxBaseUrl }),
    });
    this.uni = new UniswapAIClient();
    this.signer = new PlanSigner(cfg.signerPrivateKey);
    this.chain = createChainClient(cfg.rpcUrl);
  }

  get signerAddress(): `0x${string}` {
    return this.signer.address;
  }

  async check(rawIntent: unknown, rawLimits: unknown = {}): Promise<VerifyResponse> {
    const intent = IntentSchema.parse(rawIntent);
    const limits = RiskLimitsSchema.parse(rawLimits);
    const checks: CheckResult[] = [];

    const fail = (
      step: string,
      details: Record<string, unknown>,
      reasonCode: ReasonCodeKey,
    ): VerifyResponse => {
      checks.push({ step, pass: false, details, reasonCode });
      return {
        verdict: "fail",
        checks,
        failedReasonCodes: [reasonCode],
        verifiedAt: Date.now(),
      };
    };
    const pass = (step: string, details: Record<string, unknown>): void => {
      checks.push({ step, pass: true, details });
    };

    let okxQuote;
    try {
      okxQuote = await this.okx.getQuote({
        fromToken: intent.fromToken,
        toToken: intent.toToken,
        amount: intent.amount,
      });
    } catch (e) {
      return fail("1.route-discovery", { error: String(e) }, "ROUTE_NOT_FOUND");
    }

    let uniQuote: UniswapRouteResult | undefined;
    try {
      uniQuote = await this.uni.getRoute({
        chainId: X_LAYER_CHAIN_ID,
        fromToken: intent.fromToken,
        toToken: intent.toToken,
        amount: intent.amount,
      });
    } catch {
      // Uniswap may lack liquidity on X Layer for some pairs — non-fatal.
    }
    pass("1.route-discovery", {
      okxToAmount: okxQuote.toAmount,
      uniToAmount: uniQuote?.toAmount ?? null,
      liquiditySources: okxQuote.liquiditySources,
    });

    if (uniQuote) {
      const okxOut = BigInt(okxQuote.toAmount);
      const uniOut = BigInt(uniQuote.toAmount);
      const min = okxOut < uniOut ? okxOut : uniOut;
      const max = okxOut > uniOut ? okxOut : uniOut;
      const divergenceBps = max === 0n ? 0 : Number(((max - min) * 10_000n) / max);
      if (divergenceBps > CROSS_SOURCE_TOLERANCE_BPS) {
        return fail(
          "2.cross-source-divergence",
          { divergenceBps, toleranceBps: CROSS_SOURCE_TOLERANCE_BPS },
          "CROSS_SOURCE_DIVERGENCE",
        );
      }
      pass("2.cross-source-divergence", {
        divergenceBps,
        toleranceBps: CROSS_SOURCE_TOLERANCE_BPS,
      });
    }

    const fromAmount = BigInt(intent.amount);
    let balance: bigint;
    try {
      balance = await getErc20Balance(
        this.chain,
        intent.fromToken as `0x${string}`,
        intent.caller as `0x${string}`,
      );
    } catch (e) {
      return fail("3.balance-check", { error: String(e) }, "INSUFFICIENT_BALANCE");
    }
    if (balance < fromAmount) {
      return fail(
        "3.balance-check",
        { balance: balance.toString(), required: fromAmount.toString() },
        "INSUFFICIENT_BALANCE",
      );
    }
    pass("3.balance-check", {
      balance: balance.toString(),
      required: fromAmount.toString(),
    });

    let allowance: bigint;
    try {
      allowance = await getErc20Allowance(
        this.chain,
        intent.fromToken as `0x${string}`,
        intent.caller as `0x${string}`,
        okxQuote.routerAddress as `0x${string}`,
      );
    } catch (e) {
      return fail("4.allowance-check", { error: String(e) }, "INSUFFICIENT_ALLOWANCE");
    }
    if (allowance < fromAmount) {
      return fail(
        "4.allowance-check",
        {
          allowance: allowance.toString(),
          required: fromAmount.toString(),
          spender: okxQuote.routerAddress,
        },
        "INSUFFICIENT_ALLOWANCE",
      );
    }
    pass("4.allowance-check", {
      allowance: allowance.toString(),
      required: fromAmount.toString(),
      spender: okxQuote.routerAddress,
    });

    const sim = await this.okx.simulateTx({
      from: intent.caller,
      to: okxQuote.routerAddress,
      data: okxQuote.callData,
      value: okxQuote.value,
    });
    if (!sim.success) {
      return fail(
        "5.simulate-tx",
        { gasUsed: sim.gasUsed, revertReason: sim.revertReason ?? null },
        "ROUTE_SIMULATION_FAILED",
      );
    }
    pass("5.simulate-tx", { gasUsed: sim.gasUsed });

    const tokenInfo = await this.okx.getTokenInfo(intent.toToken);
    const concentration = tokenInfo.topHolderConcentrationPct ?? 0;
    const tokenAge = tokenInfo.createdAt
      ? Math.floor(Date.now() / 1000) - tokenInfo.createdAt
      : Number.MAX_SAFE_INTEGER;
    if (concentration > limits.maxHolderConcentrationPct) {
      return fail(
        "6.token-safety",
        { concentration, max: limits.maxHolderConcentrationPct },
        "HOLDER_CONCENTRATION_TOO_HIGH",
      );
    }
    if (tokenInfo.verified === false || tokenAge < limits.minTokenAgeSeconds) {
      return fail(
        "6.token-safety",
        { verified: tokenInfo.verified, ageSeconds: tokenAge },
        "TOKEN_UNSAFE",
      );
    }
    pass("6.token-safety", {
      symbol: tokenInfo.symbol,
      verified: tokenInfo.verified ?? null,
      concentration,
      ageSeconds: tokenAge,
    });

    if (okxQuote.estimatedSlippageBps > limits.maxSlippageBps) {
      return fail(
        "7.slippage",
        {
          estimatedBps: okxQuote.estimatedSlippageBps,
          maxBps: limits.maxSlippageBps,
        },
        "SLIPPAGE_EXCEEDED",
      );
    }
    pass("7.slippage", {
      estimatedBps: okxQuote.estimatedSlippageBps,
      maxBps: limits.maxSlippageBps,
    });

    const quoteAge = (Date.now() - okxQuote.quotedAt) / 1000;
    if (quoteAge > limits.maxStaleQuoteSeconds) {
      return fail(
        "8.quote-freshness",
        { ageSeconds: quoteAge, maxSeconds: limits.maxStaleQuoteSeconds },
        "STALE_QUOTE",
      );
    }
    pass("8.quote-freshness", {
      ageSeconds: quoteAge,
      maxSeconds: limits.maxStaleQuoteSeconds,
    });

    const portfolio = await this.okx.getPortfolio(intent.caller);
    const tradeUsd = await this.estimateTradeUsdValue(intent, okxQuote.toAmount);
    const portfolioImpactPct =
      portfolio.totalValueUsd > 0 ? (tradeUsd / portfolio.totalValueUsd) * 100 : 0;
    if (portfolioImpactPct > limits.maxPortfolioImpactPct) {
      return fail(
        "9.portfolio-policy",
        {
          portfolioValueUsd: portfolio.totalValueUsd,
          tradeValueUsd: tradeUsd,
          impactPct: portfolioImpactPct,
          maxPct: limits.maxPortfolioImpactPct,
        },
        "PORTFOLIO_IMPACT_TOO_HIGH",
      );
    }
    pass("9.portfolio-policy", {
      portfolioValueUsd: portfolio.totalValueUsd,
      tradeValueUsd: tradeUsd,
      impactPct: portfolioImpactPct,
      maxPct: limits.maxPortfolioImpactPct,
    });

    const gasPriceWei = await this.okx.getGasPriceWei();
    const gasLimit = sim.gasUsed && sim.gasUsed !== "0" ? sim.gasUsed : "300000";
    const estimatedCostWei = (BigInt(gasPriceWei) * BigInt(gasLimit)).toString();
    pass("10.gas-budget", { gasPriceWei, gasLimit, estimatedCostWei });

    const plan: VerifiedPlan = {
      intent,
      route: {
        source: "okx-dex",
        fromAmount: okxQuote.fromAmount,
        toAmount: okxQuote.toAmount,
        estimatedSlippageBps: okxQuote.estimatedSlippageBps,
        routerAddress: okxQuote.routerAddress,
        callData: okxQuote.callData,
        value: okxQuote.value,
      },
      gas: { gasPriceWei, gasLimit, estimatedCostWei },
      expiresAt: Date.now() + PLAN_TTL_MS,
      nonce: planNonce(),
    };
    const signature = await this.signer.sign(plan, limits.maxSlippageBps);

    return {
      verdict: "pass",
      plan,
      signature,
      signer: this.signer.address,
      checks,
      failedReasonCodes: [],
      verifiedAt: Date.now(),
    };
  }

  private async estimateTradeUsdValue(intent: Intent, toAmount: string): Promise<number> {
    try {
      const { price } = await this.okx.getMarketPriceUsd(intent.toToken);
      const tokenInfo = await this.okx.getTokenInfo(intent.toToken);
      const human = Number(toAmount) / 10 ** tokenInfo.decimals;
      return human * price;
    } catch {
      return 0;
    }
  }
}

export { PlanSigner } from "./signer.js";
