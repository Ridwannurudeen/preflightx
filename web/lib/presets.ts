export type Preset = {
  id: string;
  label: string;
  description: string;
  intent: {
    action: "swap";
    fromToken: string;
    toToken: string;
    amount: string;
    caller: string;
  };
  limits: {
    maxSlippageBps: number;
    maxHolderConcentrationPct: number;
    minTokenAgeSeconds: number;
    maxPortfolioImpactPct: number;
    maxStaleQuoteSeconds: number;
    maxGasCostWei?: string;
  };
  expectedOutcome: "pass" | "block";
  expectedReason?: string;
};

const USDC = "0x74b7F16337b8972027F6196A17a631aC6dE26d22";
const OKB = "0xe538905cf8410324e03A5A23C1c177a474D59b2b";
const USDT = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d";
const DEMO_CALLER = "0xefb90722a4731c01d64adb11e4dd8d76dd73911e";

export type PolicyProfile = {
  id: string;
  name: string;
  description: string;
  limits: Preset["limits"];
};

export const POLICY_PROFILES: PolicyProfile[] = [
  {
    id: "conservative",
    name: "Conservative",
    description: "Retail wallet. Tight slippage, low concentration tolerance, fresh market data only.",
    limits: {
      maxSlippageBps: 50,
      maxHolderConcentrationPct: 30,
      minTokenAgeSeconds: 604_800,
      maxPortfolioImpactPct: 10,
      maxStaleQuoteSeconds: 30,
      maxGasCostWei: "200000000000000",
    },
  },
  {
    id: "treasury",
    name: "Treasury",
    description: "DAO or agentic treasury. Moderate slippage, older-token bias, explicit gas cap.",
    limits: {
      maxSlippageBps: 100,
      maxHolderConcentrationPct: 40,
      minTokenAgeSeconds: 2_592_000,
      maxPortfolioImpactPct: 25,
      maxStaleQuoteSeconds: 60,
      maxGasCostWei: "400000000000000",
    },
  },
  {
    id: "degen",
    name: "Degen",
    description: "Size up quickly on new tokens with wider limits, but still signed and enforced.",
    limits: {
      maxSlippageBps: 500,
      maxHolderConcentrationPct: 90,
      minTokenAgeSeconds: 0,
      maxPortfolioImpactPct: 100,
      maxStaleQuoteSeconds: 120,
    },
  },
];

export const PRESETS: Preset[] = [
  {
    id: "safe-usdc-okb",
    label: "Safe trade: 0.1 USDC to OKB",
    description:
      "Known pair, caller holds balance, and the result should return a signed guard-ready plan.",
    intent: {
      action: "swap",
      fromToken: USDC,
      toToken: OKB,
      amount: "100000",
      caller: DEMO_CALLER,
    },
    limits: {
      maxSlippageBps: 200,
      maxHolderConcentrationPct: 80,
      minTokenAgeSeconds: 0,
      maxPortfolioImpactPct: 100,
      maxStaleQuoteSeconds: 60,
    },
    expectedOutcome: "pass",
  },
  {
    id: "strict-concentration",
    label: "Strict policy: top holders must stay below 5%",
    description:
      "Uses an intentionally unrealistic concentration cap to prove the holder-concentration check blocks the trade.",
    intent: {
      action: "swap",
      fromToken: USDC,
      toToken: OKB,
      amount: "100000",
      caller: DEMO_CALLER,
    },
    limits: {
      maxSlippageBps: 200,
      maxHolderConcentrationPct: 5,
      minTokenAgeSeconds: 0,
      maxPortfolioImpactPct: 100,
      maxStaleQuoteSeconds: 60,
    },
    expectedOutcome: "block",
    expectedReason: "HOLDER_CONCENTRATION_TOO_HIGH",
  },
  {
    id: "tight-slippage",
    label: "Tight slippage: allow only 1 bps",
    description:
      "Caller sets a slippage envelope narrower than the aggregator quote. PreflightX blocks before execution.",
    intent: {
      action: "swap",
      fromToken: USDC,
      toToken: OKB,
      amount: "100000",
      caller: DEMO_CALLER,
    },
    limits: {
      maxSlippageBps: 1,
      maxHolderConcentrationPct: 80,
      minTokenAgeSeconds: 0,
      maxPortfolioImpactPct: 100,
      maxStaleQuoteSeconds: 60,
    },
    expectedOutcome: "block",
    expectedReason: "SLIPPAGE_EXCEEDED",
  },
  {
    id: "insufficient-balance",
    label: "Missing balance: caller holds no USDC",
    description:
      "Direct X Layer RPC balanceOf returns less than intent.amount. The verifier stops at the balance check.",
    intent: {
      action: "swap",
      fromToken: USDC,
      toToken: OKB,
      amount: "100000000000",
      caller: "0x0000000000000000000000000000000000000001",
    },
    limits: {
      maxSlippageBps: 200,
      maxHolderConcentrationPct: 80,
      minTokenAgeSeconds: 0,
      maxPortfolioImpactPct: 100,
      maxStaleQuoteSeconds: 60,
    },
    expectedOutcome: "block",
    expectedReason: "INSUFFICIENT_BALANCE",
  },
  {
    id: "stable-to-stable",
    label: "Stable to Stable: 0.1 USDC to USDT",
    description:
      "A stable pair that should normally pass unless a policy profile makes it stricter.",
    intent: {
      action: "swap",
      fromToken: USDC,
      toToken: USDT,
      amount: "100000",
      caller: DEMO_CALLER,
    },
    limits: {
      maxSlippageBps: 100,
      maxHolderConcentrationPct: 80,
      minTokenAgeSeconds: 0,
      maxPortfolioImpactPct: 100,
      maxStaleQuoteSeconds: 60,
    },
    expectedOutcome: "pass",
  },
];
