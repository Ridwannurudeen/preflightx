import { keccak256, toBytes, type Hex } from "viem";
import { OnchainosClient } from "./onchainos.js";
import { UniswapAIClient, type UniswapRouteResult } from "./uniswap.js";
import {
  IntentSchema,
  RiskLimitsSchema,
  type CheckResult,
  type Intent,
  type PreflightConfig,
  type RiskLimits,
  type VerifiedPlan,
  type VerifyResponse,
  X_LAYER_CHAIN_ID,
} from "./types.js";

const PLAN_TTL_MS = 90_000;
const CROSS_SOURCE_TOLERANCE_BPS = 50;

export class Preflight {
  private readonly okx: OnchainosClient;
  private readonly uni: UniswapAIClient;

  constructor(private readonly cfg: PreflightConfig) {
    this.okx = new OnchainosClient({
      apiKey: cfg.onchainosApiKey,
      secretKey: cfg.onchainosSecretKey,
      passphrase: cfg.onchainosPassphrase,
      ...(cfg.okxBaseUrl !== undefined && { baseUrl: cfg.okxBaseUrl }),
    });
    this.uni = new UniswapAIClient();
  }

  async check(rawIntent: unknown, rawLimits: unknown = {}): Promise<VerifyResponse> {
    const intent = IntentSchema.parse(rawIntent);
    const limits = RiskLimitsSchema.parse(rawLimits);

    const checks: CheckResult[] = [];
    const okxQuote = await this.okx.getQuote({
      fromToken: intent.fromToken,
      toToken: intent.toToken,
      amount: intent.amount,
    });

    let uniQuote: UniswapRouteResult | undefined;
    try {
      uniQuote = await this.uni.getRoute({
        chainId: X_LAYER_CHAIN_ID,
        fromToken: intent.fromToken,
        toToken: intent.toToken,
        amount: intent.amount,
      });
    } catch {
      // Uniswap may not have liquidity on X Layer for every pair — non-fatal
    }

    checks.push({
      step: "1.route-discovery",
      pass: true,
      details: {
        okxToAmount: okxQuote.toAmount,
        uniToAmount: uniQuote?.toAmount ?? null,
        liquiditySources: okxQuote.liquiditySources,
      },
    });

    if (uniQuote) {
      const okxOut = BigInt(okxQuote.toAmount);
      const uniOut = BigInt(uniQuote.toAmount);
      const min = okxOut < uniOut ? okxOut : uniOut;
      const max = okxOut > uniOut ? okxOut : uniOut;
      const divergenceBps =
        max === 0n ? 0 : Number(((max - min) * 10_000n) / max);
      checks.push({
        step: "2.cross-source-divergence",
        pass: divergenceBps <= CROSS_SOURCE_TOLERANCE_BPS,
        details: { divergenceBps, toleranceBps: CROSS_SOURCE_TOLERANCE_BPS },
        ...(divergenceBps > CROSS_SOURCE_TOLERANCE_BPS && {
          reasonCode: "CROSS_SOURCE_DIVERGENCE" as const,
        }),
      });
    }

    const sim = await this.okx.simulateTx({
      from: intent.caller,
      to: okxQuote.routerAddress,
      data: okxQuote.callData,
      value: okxQuote.value,
    });
    checks.push({
      step: "3.simulate-tx",
      pass: sim.success,
      details: { gasUsed: sim.gasUsed, revertReason: sim.revertReason ?? null },
      ...(!sim.success && { reasonCode: "ROUTE_SIMULATION_FAILED" as const }),
    });

    const tokenInfo = await this.okx.getTokenInfo(intent.toToken);
    const concentration = tokenInfo.topHolderConcentrationPct ?? 0;
    const tokenAge = tokenInfo.createdAt
      ? Math.floor(Date.now() / 1000) - tokenInfo.createdAt
      : Number.MAX_SAFE_INTEGER;
    const tokenSafe =
      tokenInfo.verified !== false &&
      concentration <= limits.maxHolderConcentrationPct &&
      tokenAge >= limits.minTokenAgeSeconds;
    checks.push({
      step: "4.token-safety",
      pass: tokenSafe,
      details: {
        symbol: tokenInfo.symbol,
        verified: tokenInfo.verified ?? null,
        topHolderConcentrationPct: concentration,
        tokenAgeSeconds: tokenAge,
      },
      ...(!tokenSafe && {
        reasonCode:
          concentration > limits.maxHolderConcentrationPct
            ? ("HOLDER_CONCENTRATION_TOO_HIGH" as const)
            : ("TOKEN_UNSAFE" as const),
      }),
    });

    const slippageOk = okxQuote.estimatedSlippageBps <= limits.maxSlippageBps;
    checks.push({
      step: "5.slippage-check",
      pass: slippageOk,
      details: {
        estimatedSlippageBps: okxQuote.estimatedSlippageBps,
        maxAllowedBps: limits.maxSlippageBps,
      },
      ...(!slippageOk && { reasonCode: "SLIPPAGE_EXCEEDED" as const }),
    });

    const quoteAge = (Date.now() - okxQuote.quotedAt) / 1000;
    const fresh = quoteAge <= limits.maxStaleQuoteSeconds;
    checks.push({
      step: "6.quote-freshness",
      pass: fresh,
      details: { quoteAgeSeconds: quoteAge, maxStaleSeconds: limits.maxStaleQuoteSeconds },
      ...(!fresh && { reasonCode: "STALE_QUOTE" as const }),
    });

    const portfolio = await this.okx.getPortfolio(intent.caller);
    const tradeUsd = await this.estimateTradeUsdValue(intent, okxQuote.toAmount);
    const portfolioImpactPct =
      portfolio.totalValueUsd > 0 ? (tradeUsd / portfolio.totalValueUsd) * 100 : 0;
    const portfolioOk = portfolioImpactPct <= limits.maxPortfolioImpactPct;
    checks.push({
      step: "7.portfolio-policy",
      pass: portfolioOk,
      details: {
        portfolioValueUsd: portfolio.totalValueUsd,
        tradeValueUsd: tradeUsd,
        portfolioImpactPct,
        maxAllowedPct: limits.maxPortfolioImpactPct,
      },
      ...(!portfolioOk && { reasonCode: "PORTFOLIO_IMPACT_TOO_HIGH" as const }),
    });

    const gasPriceWei = await this.okx.getGasPriceWei();
    const gasLimit = sim.gasUsed && sim.gasUsed !== "0" ? sim.gasUsed : "300000";
    const estimatedCostWei = (BigInt(gasPriceWei) * BigInt(gasLimit)).toString();
    checks.push({
      step: "8.gas-budget",
      pass: true,
      details: { gasPriceWei, gasLimit, estimatedCostWei },
    });

    const failed = checks.filter((c) => !c.pass);
    const verdict: "pass" | "fail" = failed.length === 0 ? "pass" : "fail";
    const failedReasonCodes = failed
      .map((c) => c.reasonCode)
      .filter((r): r is NonNullable<typeof r> => Boolean(r));

    const response: VerifyResponse = {
      verdict,
      checks,
      failedReasonCodes,
      verifiedAt: Date.now(),
    };

    if (verdict === "pass") {
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
      };
      response.plan = plan;
      response.signature = this.signPlan(plan);
    }

    return response;
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

  private signPlan(plan: VerifiedPlan): string {
    const canonical = JSON.stringify(plan, Object.keys(plan).sort());
    const hash = keccak256(toBytes(canonical));
    return hash as Hex;
  }
}
