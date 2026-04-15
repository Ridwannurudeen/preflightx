import { z } from "zod";

export const X_LAYER_CHAIN_ID = 196;

export const IntentSchema = z.object({
  action: z.enum(["swap"]),
  fromToken: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "fromToken must be a 0x address"),
  toToken: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "toToken must be a 0x address"),
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
  maxGasCostWei: z.string().regex(/^\d+$/).optional(),
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
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  INSUFFICIENT_ALLOWANCE: "INSUFFICIENT_ALLOWANCE",
} as const;

export type ReasonCodeKey = keyof typeof ReasonCode;

export interface CheckResult {
  step: string;
  pass: boolean;
  details: Record<string, unknown>;
  reasonCode?: ReasonCodeKey;
}

export interface VerifiedPlan {
  caller: `0x${string}`;
  fromToken: `0x${string}`;
  toToken: `0x${string}`;
  fromAmount: string;
  minToAmount: string;
  router: `0x${string}`;
  callData: `0x${string}`;
  value: string;
  expiresAt: number;
  nonce: `0x${string}`;
}

export interface QuoteSummary {
  source: "okx-dex";
  expectedToAmount: string;
  estimatedSlippageBps: number;
  liquiditySources: string[];
  approvalTarget: `0x${string}`;
  gasPriceWei: string;
  gasLimit: string;
  estimatedCostWei: string;
  quotedAt: number;
  priceUpdatedAt?: number;
  tokenSymbol: string;
  tokenTags: string[];
  riskControlLevel?: number;
  top10HoldPercent?: number;
  tokenAgeSeconds?: number;
}

export interface VerifyResponse {
  verdict: "pass" | "fail";
  plan?: VerifiedPlan;
  quote?: QuoteSummary;
  checks: CheckResult[];
  failedReasonCodes: ReasonCodeKey[];
  signature?: `0x${string}`;
  signer?: `0x${string}`;
  verifiedAt: number;
}

export interface PreflightConfig {
  onchainosApiKey: string;
  onchainosSecretKey: string;
  onchainosPassphrase: string;
  signerPrivateKey: `0x${string}`;
  okxBaseUrl?: string;
  rpcUrl?: string;
  guardContractAddress?: `0x${string}`;
}

export const EIP712_DOMAIN = {
  name: "PreflightX",
  version: "1",
  chainId: X_LAYER_CHAIN_ID,
} as const;

export const EIP712_TYPES = {
  VerifiedPlan: [
    { name: "caller", type: "address" },
    { name: "fromToken", type: "address" },
    { name: "toToken", type: "address" },
    { name: "fromAmount", type: "uint256" },
    { name: "minToAmount", type: "uint256" },
    { name: "router", type: "address" },
    { name: "callData", type: "bytes" },
    { name: "value", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface EIP712Plan {
  caller: `0x${string}`;
  fromToken: `0x${string}`;
  toToken: `0x${string}`;
  fromAmount: bigint;
  minToAmount: bigint;
  router: `0x${string}`;
  callData: `0x${string}`;
  value: bigint;
  expiresAt: bigint;
  nonce: `0x${string}`;
}

export function deriveMinToAmount(toAmount: string, slippageBps: number): string {
  const expectedOut = BigInt(toAmount);
  const minOut = expectedOut - (expectedOut * BigInt(slippageBps)) / 10_000n;
  return minOut.toString();
}

export function planToEip712(plan: VerifiedPlan): EIP712Plan {
  return {
    caller: plan.caller,
    fromToken: plan.fromToken,
    toToken: plan.toToken,
    fromAmount: BigInt(plan.fromAmount),
    minToAmount: BigInt(plan.minToAmount),
    router: plan.router,
    callData: plan.callData,
    value: BigInt(plan.value || "0"),
    expiresAt: BigInt(plan.expiresAt),
    nonce: plan.nonce,
  };
}
