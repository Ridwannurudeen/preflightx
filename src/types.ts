import { z } from "zod";

export const X_LAYER_CHAIN_ID = 196;

export const IntentSchema = z.object({
  action: z.enum(["swap"]),
  fromToken: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "fromToken must be a checksummed 0x address"),
  toToken: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "toToken must be a checksummed 0x address"),
  amount: z.string().regex(/^\d+$/, "amount must be a base-unit integer string"),
  caller: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.literal(X_LAYER_CHAIN_ID).default(X_LAYER_CHAIN_ID),
});

export type Intent = z.infer<typeof IntentSchema>;

export const RiskLimitsSchema = z.object({
  maxSlippageBps: z.number().int().positive().max(10_000).default(200),
  maxHolderConcentrationPct: z.number().min(0).max(100).default(50),
  minTokenAgeSeconds: z.number().int().nonnegative().default(0),
  maxPortfolioImpactPct: z.number().min(0).max(100).default(25),
  maxStaleQuoteSeconds: z.number().int().positive().default(60),
});

export type RiskLimits = z.infer<typeof RiskLimitsSchema>;

export const ReasonCode = {
  ROUTE_NOT_FOUND: "ROUTE_NOT_FOUND",
  ROUTE_SIMULATION_FAILED: "ROUTE_SIMULATION_FAILED",
  SLIPPAGE_EXCEEDED: "SLIPPAGE_EXCEEDED",
  TOKEN_UNSAFE: "TOKEN_UNSAFE",
  HOLDER_CONCENTRATION_TOO_HIGH: "HOLDER_CONCENTRATION_TOO_HIGH",
  PRICE_DEVIATION_TOO_HIGH: "PRICE_DEVIATION_TOO_HIGH",
  PORTFOLIO_IMPACT_TOO_HIGH: "PORTFOLIO_IMPACT_TOO_HIGH",
  GAS_INSUFFICIENT: "GAS_INSUFFICIENT",
  STALE_QUOTE: "STALE_QUOTE",
  CROSS_SOURCE_DIVERGENCE: "CROSS_SOURCE_DIVERGENCE",
} as const;

export type ReasonCodeKey = keyof typeof ReasonCode;

export interface CheckResult {
  step: string;
  pass: boolean;
  details: Record<string, unknown>;
  reasonCode?: ReasonCodeKey;
}

export interface VerifiedPlan {
  intent: Intent;
  route: {
    source: "okx-dex" | "uniswap";
    fromAmount: string;
    toAmount: string;
    estimatedSlippageBps: number;
    routerAddress: string;
    callData: string;
    value: string;
  };
  gas: {
    gasPriceWei: string;
    gasLimit: string;
    estimatedCostWei: string;
  };
  expiresAt: number;
}

export interface VerifyResponse {
  verdict: "pass" | "fail";
  plan?: VerifiedPlan;
  checks: CheckResult[];
  failedReasonCodes: ReasonCodeKey[];
  signature?: string;
  verifiedAt: number;
}

export interface PreflightConfig {
  onchainosApiKey: string;
  onchainosSecretKey: string;
  onchainosPassphrase: string;
  okxBaseUrl?: string;
  rpcUrl?: string;
  signerPrivateKey?: `0x${string}`;
  staleQuoteCacheMs?: number;
}
