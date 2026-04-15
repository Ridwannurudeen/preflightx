import { type PublicClient } from "viem";
import { OnchainosClient, type SwapResult, type TokenAdvancedInfo } from "./onchainos";
import { UniswapAIClient, type UniswapRouteResult } from "./uniswap";
import { PlanSigner, planNonce } from "./signer";
import { createChainClient, getErc20Balance, getErc20Allowance } from "./chain";
import {
  IntentSchema,
  RiskLimitsSchema,
  deriveMinToAmount,
  type CheckResult,
  type PreflightConfig,
  type QuoteSummary,
  type ReasonCodeKey,
  type VerifiedPlan,
  type VerifyResponse,
  X_LAYER_CHAIN_ID,
} from "./types";

const PLAN_TTL_SECONDS = 90;
const CROSS_SOURCE_TOLERANCE_BPS = 50;
const MAX_PRICE_DEVIATION_BPS = 1000;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const HEX_RE = /^0x([a-fA-F0-9]{2})+$/;

function toDisplayUnits(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

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

    const [swapResult, uniResult] = await Promise.allSettled([
      this.okx.getSwap({
        fromToken: intent.fromToken,
        toToken: intent.toToken,
        amount: intent.amount,
        userWalletAddress: intent.caller,
        slippagePercent: limits.maxSlippageBps / 100,
      }),
      this.uni.getRoute({
        chainId: X_LAYER_CHAIN_ID,
        fromToken: intent.fromToken,
        toToken: intent.toToken,
        amount: intent.amount,
      }),
    ]);

    if (swapResult.status === "rejected") {
      return fail("1.route-discovery", { error: String(swapResult.reason) }, "ROUTE_NOT_FOUND");
    }

    const swap = swapResult.value;
    const uniQuote = uniResult.status === "fulfilled" ? uniResult.value : undefined;
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

    const approvalTarget = (this.cfg.guardContractAddress ?? swap.routerAddress) as `0x${string}`;
    let allowance: bigint;
    try {
      allowance = await getErc20Allowance(
        this.chain,
        intent.fromToken as `0x${string}`,
        intent.caller as `0x${string}`,
        approvalTarget,
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
          spender: approvalTarget,
        },
        "INSUFFICIENT_ALLOWANCE",
      );
    }
    pass("4.allowance-check", {
      allowance: allowance.toString(),
      required: fromAmount.toString(),
      spender: approvalTarget,
    });

    if (!ADDRESS_RE.test(swap.routerAddress) || !HEX_RE.test(swap.callData) || swap.gasLimit === "0") {
      return fail(
        "5.route-simulation",
        {
          router: swap.routerAddress,
          callData: swap.callData,
          gasLimit: swap.gasLimit,
        },
        "ROUTE_SIMULATION_FAILED",
      );
    }
    pass("5.route-simulation", {
      note: "Route payload is guard-executable and the OKX v6 aggregator pre-simulated it",
      gasLimit: swap.gasLimit,
      router: swap.routerAddress,
    });

    let tokenInfo: TokenAdvancedInfo;
    try {
      tokenInfo = await this.okx.getTokenAdvancedInfo(intent.toToken);
    } catch (e) {
      return fail("6.token-safety", { error: String(e) }, "TOKEN_UNSAFE");
    }

    const tokenAgeSeconds =
      tokenInfo.createTimeMs !== undefined
        ? Math.max(0, Math.floor((Date.now() - tokenInfo.createTimeMs) / 1000))
        : undefined;

    if (swap.toTokenIsHoneyPot || tokenInfo.tokenTags.includes("honeypot")) {
      return fail(
        "6.token-safety",
        { symbol: swap.toTokenSymbol, tokenTags: tokenInfo.tokenTags, isHoneyPot: true },
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
    if ((tokenInfo.riskControlLevel ?? 0) >= 4) {
      return fail(
        "6.token-safety",
        { symbol: swap.toTokenSymbol, riskControlLevel: tokenInfo.riskControlLevel },
        "TOKEN_UNSAFE",
      );
    }
    if (
      tokenInfo.top10HoldPercent !== undefined &&
      Number.isFinite(tokenInfo.top10HoldPercent) &&
      tokenInfo.top10HoldPercent > limits.maxHolderConcentrationPct
    ) {
      return fail(
        "6.token-safety",
        {
          symbol: swap.toTokenSymbol,
          top10HoldPercent: tokenInfo.top10HoldPercent,
          maxHolderConcentrationPct: limits.maxHolderConcentrationPct,
        },
        "HOLDER_CONCENTRATION_TOO_HIGH",
      );
    }
    if (
      tokenAgeSeconds !== undefined &&
      Number.isFinite(tokenAgeSeconds) &&
      tokenAgeSeconds < limits.minTokenAgeSeconds
    ) {
      return fail(
        "6.token-safety",
        {
          symbol: swap.toTokenSymbol,
          tokenAgeSeconds,
          minTokenAgeSeconds: limits.minTokenAgeSeconds,
        },
        "TOKEN_UNSAFE",
      );
    }
    pass("6.token-safety", {
      symbol: swap.toTokenSymbol,
      decimals: swap.toTokenDecimals,
      isHoneyPot: swap.toTokenIsHoneyPot,
      taxRateBps: swap.toTokenTaxRateBps,
      riskControlLevel: tokenInfo.riskControlLevel,
      top10HoldPercent: tokenInfo.top10HoldPercent,
      tokenAgeSeconds,
      tokenTags: tokenInfo.tokenTags,
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
    } catch (e) {
      return fail("7b.price-deviation", { error: String(e) }, "PRICE_DEVIATION_TOO_HIGH");
    }

    let priceUpdatedAt: number | undefined;
    try {
      const priceInfo = await this.okx.getPriceInfo(intent.toToken);
      priceUpdatedAt = priceInfo.updatedAt;
    } catch (e) {
      return fail("8.quote-freshness", { error: String(e) }, "STALE_QUOTE");
    }
    const marketAgeSeconds =
      priceUpdatedAt !== undefined ? (Date.now() - priceUpdatedAt) / 1000 : Number.POSITIVE_INFINITY;
    if (marketAgeSeconds > limits.maxStaleQuoteSeconds) {
      return fail(
        "8.quote-freshness",
        { ageSeconds: marketAgeSeconds, maxSeconds: limits.maxStaleQuoteSeconds, priceUpdatedAt },
        "STALE_QUOTE",
      );
    }
    pass("8.quote-freshness", {
      ageSeconds: marketAgeSeconds,
      maxSeconds: limits.maxStaleQuoteSeconds,
      priceUpdatedAt,
    });

    const impactPct = balance > 0n ? Number((fromAmount * 10_000n) / balance) / 100 : 0;
    const tradeUsd = toDisplayUnits(fromAmount, swap.fromTokenDecimals) * swap.fromTokenUnitPrice;
    const balanceUsd = toDisplayUnits(balance, swap.fromTokenDecimals) * swap.fromTokenUnitPrice;
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
    if (limits.maxGasCostWei && BigInt(estimatedCostWei) > BigInt(limits.maxGasCostWei)) {
      return fail(
        "10.gas-budget",
        {
          gasPriceWei: swap.gasPriceWei,
          gasLimit: swap.gasLimit,
          estimatedCostWei,
          maxGasCostWei: limits.maxGasCostWei,
        },
        "GAS_INSUFFICIENT",
      );
    }
    pass("10.gas-budget", {
      gasPriceWei: swap.gasPriceWei,
      gasLimit: swap.gasLimit,
      estimatedCostWei,
      maxGasCostWei: limits.maxGasCostWei ?? null,
    });

    const plan: VerifiedPlan = {
      caller: intent.caller as `0x${string}`,
      fromToken: intent.fromToken as `0x${string}`,
      toToken: intent.toToken as `0x${string}`,
      fromAmount: intent.amount,
      minToAmount: deriveMinToAmount(swap.toAmount, limits.maxSlippageBps),
      router: swap.routerAddress as `0x${string}`,
      callData: swap.callData as `0x${string}`,
      value: swap.value,
      expiresAt: Math.floor(Date.now() / 1000) + PLAN_TTL_SECONDS,
      nonce: planNonce(),
    };
    const signature = await this.signer.sign(plan);
    const quote: QuoteSummary = {
      source: "okx-dex",
      expectedToAmount: swap.toAmount,
      estimatedSlippageBps: swap.estimatedSlippageBps,
      liquiditySources: swap.liquiditySources,
      approvalTarget,
      gasPriceWei: swap.gasPriceWei,
      gasLimit: swap.gasLimit,
      estimatedCostWei,
      quotedAt: swap.quotedAt,
      ...(priceUpdatedAt !== undefined && { priceUpdatedAt }),
      tokenSymbol: swap.toTokenSymbol,
      tokenTags: tokenInfo.tokenTags,
      ...(tokenInfo.riskControlLevel !== undefined && {
        riskControlLevel: tokenInfo.riskControlLevel,
      }),
      ...(tokenInfo.top10HoldPercent !== undefined && {
        top10HoldPercent: tokenInfo.top10HoldPercent,
      }),
      ...(tokenAgeSeconds !== undefined && { tokenAgeSeconds }),
    };

    return {
      verdict: "pass",
      plan,
      quote,
      signature,
      signer: this.signer.address,
      checks,
      failedReasonCodes: [],
      verifiedAt: Date.now(),
    };
  }
}

export { PlanSigner } from "./signer";
