# PreflightX

**Run preflight before you trade.**

PreflightX is a pre-execution verification skill for autonomous DeFi agents on X Layer. Built for the [OKX Build X Hackathon](https://web3.okx.com/xlayer/build-x-hackathon) — Skill Arena.

In one call, PreflightX composes:

- **OnchainOS DEX** — route quote across X Layer liquidity sources
- **OnchainOS Onchain Gateway** — transaction simulation, gas price
- **OnchainOS Market** — token info, holder concentration, market price
- **OnchainOS Wallet** — portfolio total value, token balances
- **Uniswap AI** — independent route quote for cross-validation

It returns either a **signed `VerifiedPlan`** ready to execute or a list of **failing reason codes**. Agents never send a doomed transaction.

## Why this exists

Every autonomous agent that swaps on-chain is one bad route, stale quote, or rug token away from a costly mistake. Existing solutions are either single-source quoters (no cross-validation) or LLM-as-judge verifiers (subjective and dismissible). PreflightX is **objective, multi-source, and composable** — every check is a numeric assertion, every failure is a reason code, and the verified plan ships with a keccak256 signature.

## Install

```bash
npm install @preflightx/skill
```

Set `ONCHAINOS_API_KEY` from the [OnchainOS Dev Portal](https://web3.okx.com/onchainos/dev-portal) and you're ready.

## Use

```ts
import { Preflight } from "@preflightx/skill";

const preflight = new Preflight({
  onchainosApiKey: process.env.ONCHAINOS_API_KEY!,
});

const result = await preflight.check(intent, limits);

if (result.verdict === "pass") {
  // execute result.plan with confidence
} else {
  console.log("Blocked:", result.failedReasonCodes);
}
```

Full intent + limits schema in [`SKILL.md`](./SKILL.md).

## How it scores against Skill Arena rubric

| Dimension | Weight | How PreflightX scores |
|---|---|---|
| OnchainOS / Uniswap Integration & Innovation | 25% | 8 distinct OnchainOS endpoints + Uniswap AI in one call. Cross-source divergence detection is a non-obvious composition. |
| X Layer Ecosystem Fit & On-Chain Activity | 25% | Every check uses live X Layer data. Verified plans are designed for X Layer execution paths. |
| AI Interaction & Novelty | 25% | Replaces LLM-as-judge with objective programmatic checks. Single-call verifier composes a pipeline that would take a human agent ~10 sequential RPC calls. |
| Product Completeness & Commercial Potential | 25% | Standalone npm package. Reusable across any X Layer DeFi agent. Ships with full type-safe API and signed-plan output for downstream contract enforcement. |

## Architecture

```
intent + limits
      │
      ▼
┌─────────────────────────────────────────────────────┐
│              Preflight.check()                       │
├─────────────────────────────────────────────────────┤
│ 1. OKX DEX quote          + Uniswap AI quote        │
│ 2. Cross-source divergence check                    │
│ 3. OKX Onchain Gateway    simulate-tx               │
│ 4. OKX Market             token-info (safety)       │
│ 5. Slippage envelope                                │
│ 6. Quote freshness                                  │
│ 7. OKX Wallet             portfolio + balances      │
│ 8. OKX Onchain Gateway    gas-price                 │
│ 9. Sign canonical plan    keccak256                 │
└─────────────────────────────────────────────────────┘
      │
      ▼
{ verdict, plan?, signature?, checks[], failedReasonCodes[] }
```

## Project layout

```
preflightx/
├── plugin.yaml          # OKX plugin store manifest
├── SKILL.md             # Skill description (markdown)
├── SKILL_SUMMARY.md     # Short skill summary
├── SUMMARY.md           # One-paragraph summary
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts         # Public API
│   ├── verifier.ts      # 9-step composition
│   ├── onchainos.ts     # OnchainOS client
│   ├── uniswap.ts       # Uniswap AI client
│   └── types.ts         # Zod schemas + types
├── test/
│   └── verifier.test.ts
└── scripts/
    └── demo.ts          # Runnable demo
```

## License

MIT
