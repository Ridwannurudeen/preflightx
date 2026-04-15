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
  };
  expectedOutcome: "pass" | "block";
  expectedReason?: string;
};

const USDC = "0x74b7F16337b8972027F6196A17a631aC6dE26d22";
const OKB = "0xe538905cf8410324e03A5A23C1c177a474D59b2b";
const USDT = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d";
const DEMO_CALLER = "0xefb90722a4731c01d64adb11e4dd8d76dd73911e";

export const PRESETS: Preset[] = [
  {
    id: "safe-usdc-okb",
    label: "Safe trade: 1 USDC → OKB",
    description:
      "Well-known tokens, recent liquidity, caller holds balance and has approved router. Expect: pass with signed plan.",
    intent: {
      action: "swap",
      fromToken: USDC,
      toToken: OKB,
      amount: "1000000",
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
    id: "rug-concentration",
    label: "Rug-risk: token with 95%+ top-holder concentration",
    description:
      "Caller wants to swap into a token whose top holders control most supply. PreflightX blocks via HOLDER_CONCENTRATION_TOO_HIGH.",
    intent: {
      action: "swap",
      fromToken: USDC,
      toToken: OKB,
      amount: "1000000",
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
      "Caller sets a slippage envelope narrower than the aggregator's quoted slippage. PreflightX blocks via SLIPPAGE_EXCEEDED before broadcast.",
    intent: {
      action: "swap",
      fromToken: USDC,
      toToken: OKB,
      amount: "1000000",
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
      "Direct X Layer RPC balanceOf returns less than intent.amount. PreflightX short-circuits at step 3 with INSUFFICIENT_BALANCE.",
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
    id: "usdc-usdt",
    label: "Stable → Stable: 1 USDC → USDT",
    description:
      "Same stable-to-stable flow. Cross-source divergence between OKX DEX and Uniswap AI is usually within 50 bps, so this passes.",
    intent: {
      action: "swap",
      fromToken: USDC,
      toToken: USDT,
      amount: "1000000",
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
