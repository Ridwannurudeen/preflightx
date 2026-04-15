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
  nonce: string;
}

export interface VerifyResponse {
  verdict: "pass" | "fail";
  plan?: VerifiedPlan;
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

export function planToEip712(plan: VerifiedPlan, slippageBps: number): EIP712Plan {
  const expectedOut = BigInt(plan.route.toAmount);
  const minOut = expectedOut - (expectedOut * BigInt(slippageBps)) / 10_000n;
  return {
    caller: plan.intent.caller as `0x${string}`,
    fromToken: plan.intent.fromToken as `0x${string}`,
    toToken: plan.intent.toToken as `0x${string}`,
    fromAmount: BigInt(plan.intent.amount),
    minToAmount: minOut,
    router: plan.route.routerAddress as `0x${string}`,
    callData: plan.route.callData as `0x${string}`,
    value: BigInt(plan.route.value || "0"),
    expiresAt: BigInt(Math.floor(plan.expiresAt / 1000)),
    nonce: plan.nonce as `0x${string}`,
  };
}
