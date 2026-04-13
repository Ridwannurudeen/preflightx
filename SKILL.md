---
name: preflightx
description: "Pre-execution verification for autonomous DeFi agents on X Layer. Composes OnchainOS DEX, market, simulation, and balance APIs with Uniswap AI to validate routes, slippage, token safety, and portfolio policy in a single call. Returns a signed verified plan or a list of blocking reason codes."
version: "0.1.0"
---

# PreflightX

**Run preflight before you trade.** PreflightX is a Skill Arena entry for the OKX Build X Hackathon. Any DeFi agent on X Layer can call `preflight.check(intent, limits)` to get a single-shot verification across 8 distinct OnchainOS skills + Uniswap AI's routing surface. If every check passes, PreflightX returns a signed `VerifiedPlan` ready for execution. If any check fails, it returns the failing reason codes — the agent never sends a doomed transaction.

## When to invoke this skill

Trigger phrases:
- "preflight this trade"
- "verify this route"
- "is this swap safe"
- "check slippage on this"
- "validate execution plan"
- "audit this trade before I send it"

Use PreflightX **before any swap, route execution, or asset move** an autonomous agent intends to perform on X Layer (chainId `196`).

## What it does — the 9 internal steps

| # | Step | OnchainOS / Uniswap surface used |
|---|---|---|
| 1 | Route discovery (dual source) | OnchainOS DEX `quote` + Uniswap AI quote |
| 2 | Cross-source divergence check | Comparison of OKX vs. Uniswap output amounts |
| 3 | Transaction simulation | OnchainOS Onchain Gateway `simulate-tx` |
| 4 | Token safety + holder concentration | OnchainOS Market `token-info` |
| 5 | Slippage envelope check | Computed against caller's `maxSlippageBps` |
| 6 | Quote freshness | Quote-age vs. `maxStaleQuoteSeconds` |
| 7 | Portfolio policy enforcement | OnchainOS Wallet `total-value` + `all-token-balances` |
| 8 | Gas budget computation | OnchainOS Onchain Gateway `gas-price` |
| 9 | Sign + return verified plan | keccak256(plan) → signature |

Failure at any step short-circuits and returns the relevant reason code.

## Installation

```bash
npm install @preflightx/skill
```

## Quick start

```ts
import { Preflight } from "@preflightx/skill";

const preflight = new Preflight({
  onchainosApiKey: process.env.ONCHAINOS_API_KEY!,
});

const result = await preflight.check(
  {
    action: "swap",
    fromToken: "0x...USDC",
    toToken: "0x...OKB",
    amount: "1000000000", // 1000 USDC base units
    caller: "0xYourAgenticWallet",
  },
  {
    maxSlippageBps: 100,           // 1.00%
    maxHolderConcentrationPct: 50, // top holder ≤ 50%
    minTokenAgeSeconds: 86400,     // ≥ 24h old
    maxPortfolioImpactPct: 25,     // ≤ 25% of portfolio per trade
    maxStaleQuoteSeconds: 60,
  },
);

if (result.verdict === "pass") {
  // result.plan is signed and ready to execute
  console.log("Verified. Slippage:", result.plan!.route.estimatedSlippageBps, "bps");
} else {
  console.log("Blocked. Reason codes:", result.failedReasonCodes);
}
```

## Output schema

```ts
type VerifyResponse = {
  verdict: "pass" | "fail";
  plan?: VerifiedPlan;        // present only on pass
  signature?: string;         // keccak256 of canonical plan
  checks: CheckResult[];      // per-step result, always returned
  failedReasonCodes: string[];
  verifiedAt: number;
};
```

Reason codes:
`ROUTE_NOT_FOUND`, `ROUTE_SIMULATION_FAILED`, `SLIPPAGE_EXCEEDED`, `TOKEN_UNSAFE`, `HOLDER_CONCENTRATION_TOO_HIGH`, `PRICE_DEVIATION_TOO_HIGH`, `PORTFOLIO_IMPACT_TOO_HIGH`, `GAS_INSUFFICIENT`, `STALE_QUOTE`, `CROSS_SOURCE_DIVERGENCE`.

## Why it's a Skill Arena fit

- **Reusable.** Any agent on X Layer with an OnchainOS API key can drop this in. Single function call, structured response.
- **Multi-skill composition.** Eight distinct OnchainOS endpoints plus Uniswap AI in one call. Not a wrapper around a single API.
- **Cross-validation.** Routes are sourced from both OKX DEX and Uniswap and compared — divergence beyond tolerance fails the check. Catches manipulated quotes that single-source verifiers miss.
- **Objective checks only.** No LLM-as-judge. Every fail has a numeric reason a human can audit.
- **Signed output.** `VerifiedPlan` carries a keccak256 signature so downstream contracts can require a fresh PreflightX signature before executing.

## Configuration

Required:
- `ONCHAINOS_API_KEY` — from the [OnchainOS Dev Portal](https://web3.okx.com/onchainos/dev-portal)

Optional:
- `OKX_BASE_URL` — override OnchainOS base URL (default `https://web3.okx.com`)
- `RPC_URL` — X Layer RPC (default `https://rpc.xlayer.tech`)

## Limits

- Returns a `VerifiedPlan` valid for **90 seconds** (`expiresAt`). Re-verify after expiry.
- `noUncheckedIndexedAccess` strict mode — call sites should null-check returned plan fields.
- Designed for single-hop swaps. Multi-hop routing is delegated to OKX DEX aggregator's internal hop selection.
