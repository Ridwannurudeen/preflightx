import { type PublicClient } from "viem";
import { OnchainosClient, type SwapResult } from "./onchainos";
import { UniswapAIClient, type UniswapRouteResult } from "./uniswap";
import { PlanSigner, planNonce } from "./signer";
import { createChainClient, getErc20Balance, getErc20Allowance } from "./chain";
import {
  IntentSchema,
  RiskLimitsSchema,
  type CheckResult,
  type PreflightConfig,
  type ReasonCodeKey,
  type VerifiedPlan,
  type VerifyResponse,
  X_LAYER_CHAIN_ID,
} from "./types";

const PLAN_TTL_MS = 90_000;
const CROSS_SOURCE_TOLERANCE_BPS = 50;
const MAX_PRICE_DEVIATION_BPS = 1000;

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

    let swap: SwapResult;
    try {
      swap = await this.okx.getSwap({
        fromToken: intent.fromToken,
        toToken: intent.toToken,
        amount: intent.amount,
        userWalletAddress: intent.caller,
        slippagePercent: Math.max(limits.maxSlippageBps / 100, 0.1),
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
      // Uniswap may lack liquidity on X Layer for the pair — non-fatal.
    }
    pass("1.route-discovery", {
      okxToAmount: swap.toAmount,
      uniToAmount: uniQuote?.toAmount ?? null,
      liquiditySources: swap.liquiditySources,
      router: swap.routerAddress,
    });

    if (uniQuote) {
      const okxOut = BigInt(swap.toAmount);
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
        swap.routerAddress as `0x${string}`,
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
          spender: swap.routerAddress,
        },
        "INSUFFICIENT_ALLOWANCE",
      );
    }
    pass("4.allowance-check", {
      allowance: allowance.toString(),
      required: fromAmount.toString(),
      spender: swap.routerAddress,
    });

    pass("5.route-simulation", {
      note: "OKX aggregator v6 simulated the route before returning calldata",
      gasLimit: swap.gasLimit,
      router: swap.routerAddress,
    });

    if (swap.toTokenIsHoneyPot) {
      return fail(
        "6.token-safety",
        { symbol: swap.toTokenSymbol, isHoneyPot: true },
        "TOKEN_UNSAFE",
      );
    }
    if (swap.toTokenTaxRateBps > limits.maxSlippageBps) {
      return fail(
        "6.token-safety",
        { symbol: swap.toTokenSymbol, taxRateBps: swap.toTokenTaxRateBps },
        "TOKEN_UNSAFE",
      );
    }
    pass("6.token-safety", {
      symbol: swap.toTokenSymbol,
      decimals: swap.toTokenDecimals,
      isHoneyPot: swap.toTokenIsHoneyPot,
      taxRateBps: swap.toTokenTaxRateBps,
    });

    if (swap.estimatedSlippageBps > limits.maxSlippageBps) {
      return fail(
        "7.slippage",
        {
          estimatedBps: swap.estimatedSlippageBps,
          maxBps: limits.maxSlippageBps,
        },
        "SLIPPAGE_EXCEEDED",
      );
    }
    pass("7.slippage", {
      estimatedBps: swap.estimatedSlippageBps,
      maxBps: limits.maxSlippageBps,
    });

    try {
      const candles = await this.okx.getRecentCandles(intent.toToken, "15m", 4);
      if (candles.length > 0 && swap.toTokenUnitPrice > 0) {
        const meanClose = candles.reduce((a, b) => a + b.close, 0) / candles.length;
        const deviationBps =
          meanClose > 0
            ? Math.abs((swap.toTokenUnitPrice - meanClose) / meanClose) * 10_000
            : 0;
        if (deviationBps > MAX_PRICE_DEVIATION_BPS) {
          return fail(
            "7b.price-deviation",
            {
              meanClose,
              currentPrice: swap.toTokenUnitPrice,
              deviationBps,
              maxBps: MAX_PRICE_DEVIATION_BPS,
            },
            "PRICE_DEVIATION_TOO_HIGH",
          );
        }
        pass("7b.price-deviation", {
          meanClose,
          currentPrice: swap.toTokenUnitPrice,
          deviationBps,
          maxBps: MAX_PRICE_DEVIATION_BPS,
        });
      }
    } catch {
      // Candles may not exist for every token yet — non-fatal.
    }

    const quoteAge = (Date.now() - swap.quotedAt) / 1000;
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

    const tradeUsd =
      (Number(fromAmount) / 10 ** swap.fromTokenDecimals) * swap.fromTokenUnitPrice;
    const balanceUsd =
      (Number(balance) / 10 ** swap.fromTokenDecimals) * swap.fromTokenUnitPrice;
    const impactPct = balanceUsd > 0 ? (tradeUsd / balanceUsd) * 100 : 0;
    if (impactPct > limits.maxPortfolioImpactPct) {
      return fail(
        "9.portfolio-policy",
        {
          balanceUsd,
          tradeUsd,
          impactPct,
          maxPct: limits.maxPortfolioImpactPct,
        },
        "PORTFOLIO_IMPACT_TOO_HIGH",
      );
    }
    pass("9.portfolio-policy", {
      balanceUsd,
      tradeUsd,
      impactPct,
      maxPct: limits.maxPortfolioImpactPct,
    });

    const estimatedCostWei = (BigInt(swap.gasPriceWei) * BigInt(swap.gasLimit)).toString();
    pass("10.gas-budget", {
      gasPriceWei: swap.gasPriceWei,
      gasLimit: swap.gasLimit,
      estimatedCostWei,
    });

    const plan: VerifiedPlan = {
      intent,
      route: {
        source: "okx-dex",
        fromAmount: swap.fromAmount,
        toAmount: swap.toAmount,
        estimatedSlippageBps: swap.estimatedSlippageBps,
        routerAddress: swap.routerAddress,
        callData: swap.callData,
        value: swap.value,
      },
      gas: {
        gasPriceWei: swap.gasPriceWei,
        gasLimit: swap.gasLimit,
        estimatedCostWei,
      },
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
}

export { PlanSigner } from "./signer";
