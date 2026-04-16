# PreflightX

[![npm](https://img.shields.io/npm/v/preflightx-skill?color=00E08F&label=npm)](https://www.npmjs.com/package/preflightx-skill)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-19%2F19%20passing-00E08F)](#verification-status)
[![Chain](https://img.shields.io/badge/X%20Layer-mainnet%20(196)-blue)](https://www.oklink.com/xlayer)
[![Guard](https://img.shields.io/badge/PreflightGuard-deployed-00E08F)](https://www.oklink.com/xlayer/address/0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb)
[![Demo](https://img.shields.io/badge/demo-asciinema-ff5f56)](https://asciinema.org/a/MlnxQZtRAilxfqgq)

**PreflightX is the safety and execution policy layer for autonomous trading agents on X Layer.**

It stops unsafe swaps before execution, explains the failure in deterministic reason codes, auto-remediates recoverable issues, and returns a signed on-chain-verifiable plan that `PreflightGuard` can enforce.

## Live artifacts

- **Track:** OKX Build X - Skill Arena
- **Live demo:** https://preflight.gudman.xyz
- **Terminal demo recording:** https://asciinema.org/a/MlnxQZtRAilxfqgq — full agent rescue end to end
- **npm:** [`preflightx-skill`](https://www.npmjs.com/package/preflightx-skill)
- **Current guard (X Layer mainnet):** [`0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb`](https://www.oklink.com/xlayer/address/0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb)
- **Current attestation signer:** [`0xeD964c21317fab45105Ac20C97a061DbBfBE8412`](https://www.oklink.com/xlayer/address/0xeD964c21317fab45105Ac20C97a061DbBfBE8412)
- **Guard deploy tx:** [`0x5986429bf92a6e5760c9f49a021984b7a224cc5945716fe2daa347aa2f661e80`](https://www.oklink.com/xlayer/tx/0x5986429bf92a6e5760c9f49a021984b7a224cc5945716fe2daa347aa2f661e80)
- **Live approval artifact:** [`0xe9ca40d55bb3e77fe83ee351a29e84d64cadce41b56b470d668e355d402b0c38`](https://www.oklink.com/xlayer/tx/0xe9ca40d55bb3e77fe83ee351a29e84d64cadce41b56b470d668e355d402b0c38)

## The problem

Autonomous DeFi agents are good at deciding *what* they want to do and weak at verifying *whether they should do it now*.

A single-source quote, stale market data, missing allowance, concentrated token ownership, oversized portfolio impact, or a malformed execution path can turn an agent trade into a bad trade. Most agent stacks either:

- trust one routing source,
- treat safety as a UI warning instead of an execution gate, or
- rely on free-form LLM judgment that is hard to audit and impossible to enforce on-chain.

## What PreflightX does

An agent calls `preflight.check(intent, limits)` before every swap.

PreflightX then:

1. pulls an OKX DEX v6 route,
2. cross-checks it against Uniswap,
3. verifies live X Layer balance and allowance,
4. checks token safety, holder concentration, token age, slippage, price deviation, freshness, portfolio impact, and optional gas budget,
5. returns either:
   - a deterministic fail with reason codes and details, or
   - a signed `PreflightGuard.executeWithPreflight` plan struct.

That signed plan is recoverable to the published signer and enforceable by the guard contract on-chain.

## Why it is different

- **Deterministic:** every block decision has an explicit reason code like `INSUFFICIENT_BALANCE`, `SLIPPAGE_EXCEEDED`, or `HOLDER_CONCENTRATION_TOO_HIGH`.
- **Agentic:** recoverable failures can be remediated automatically by resizing, widening slippage within policy, or issuing approvals.
- **Enforced:** the signed plan is not a suggestion. `PreflightGuard` rejects expired, replayed, tampered, or wrong-caller plans.
- **Composed:** it combines OKX DEX, OKX market data, direct X Layer RPC reads, Uniswap cross-validation, and an on-chain guard instead of wrapping a single API.

## Demo flow

The project is meant to be judged through the full agent loop, not just through a quote API.

```text
agent intent -> preflight.check() -> pass?
                |                   |
                |                   +-> yes -> signed guard-ready plan -> execute
                |                   |
                |                   +-> no  -> reason code + details
                |                                  |
                +------------------------------ remediate
                                           (resize, widen, approve, reroute)
```

The included `agent-demo` script shows:

- an aggressive intent,
- a deterministic block,
- plain-English explanation,
- autonomous remediation,
- a re-check that passes,
- on-chain signature verification through `PreflightGuard.verifySignature`,
- approval transaction artifact generation,
- a final report.

## Judge quickstart

### 1. Run the live demo

Open: https://preflight.gudman.xyz

### 2. Run the local agent demo

```bash
npm install
npm run agent-demo                    # safety-layer demo (guard mode)
AGENT_DEMO_MODE=direct npm run agent-demo   # full end-to-end: policy + real on-chain swap
```

**Direct-mode example run (every artifact live on X Layer mainnet):**
- Agent proposed `1.0 USDC → USDT` swap from the Agentic Wallet
- Preflight blocked `INSUFFICIENT_BALANCE` (wallet held ~0.10 USDC)
- Agent reasoned in plain English and autonomously resized to `0.091 USDC` (90% of live balance)
- Preflight PASSED with a signed `VerifiedPlan`; signature recovered to the published signer via on-chain `PreflightGuard.verifySignature()`
- Swap executed atomically through the OnchainOS swap path: [`0x9d746524…7e7e`](https://www.oklink.com/xlayer/tx/0x9d746524c2079d0eaa7d8bc7240c6d2b6a74454cefb15e5b48d67bfebe3b7e7e)
- USDC balance: `0.1011 → 0.0101` (delta matches the resized intent exactly)

### 3. Verify local integrity

```bash
npm test
npm run lint
npm run build
```

### 4. Verify the web app build

```bash
cd web
npm run build
```

## What is live today

- **npm:** [`preflightx-skill`](https://www.npmjs.com/package/preflightx-skill)
- live guard deployment on X Layer mainnet
- live signer bound to the current guard
- deterministic verifier returning the exact guard-ready plan struct
- on-chain signature verification through `PreflightGuard.verifySignature`
- OKX + Uniswap + X Layer composed verification flow
- **agent-initiated on-chain swap** through OnchainOS after policy passes
- approval artifact generation from the agent demo

## Versus other agent-safety skills on X Layer

This space has several entries in the OKX Build X Skill Arena. Here is where PreflightX differs along axes that matter for autonomous execution:

| Capability | PreflightX | Advisory warning layers (Blockaid-style) | Safety-score oracles (Guardian-style) | Intent control (Mandate-style) |
|---|---|---|---|---|
| On-chain enforcement contract | Yes · [`PreflightGuard`](https://www.oklink.com/xlayer/address/0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb) | No | No | Partial |
| EIP-712 signed plan matching the exact guard struct | Yes | No | No | No |
| Cross-source quote validation (OKX + Uniswap, >50 bps delta blocks) | Yes | Rarely | No | No |
| Autonomous remediation loop (resize, widen, approve, halve) | Yes | No | No | Yes |
| Published signer recoverable on-chain via `verifySignature` | Yes | No | No | No |
| Real agent-initiated swap tx produced by the demo | [`0x9d74…7e7e`](https://www.oklink.com/xlayer/tx/0x9d746524c2079d0eaa7d8bc7240c6d2b6a74454cefb15e5b48d67bfebe3b7e7e) | — | — | — |
| Deterministic numeric reason codes (no LLM) | 11 checks | partial | 4-6 | n/a |

The short version: most competing skills **warn** or **score**. PreflightX produces a cryptographic receipt that the guard contract verifies on-chain, so "bypassing safety" means losing access to the only sanctioned execution path — not clicking through a modal.

## What this repo does not claim

- that raw OKX v6 aggregator calldata is executed through the guard unchanged
- that `agent-demo` alone is proof of a fully automated production trading system
- that the retired signer or retired guard are still trustworthy

## Architecture

### Off-chain verifier

`src/verifier.ts` is the core engine.

It combines:

- **OKX DEX v6** for route discovery
- **OKX market endpoints** for candles and freshness checks
- **X Layer RPC** for `balanceOf` and `allowance`
- **Uniswap Trading API** for cross-source validation and guard-compatible executable routing in guard mode
- **EIP-712 signing** for the final plan attestation

### On-chain enforcement

`contracts/PreflightGuard.sol` enforces:

- signer recovery
- caller binding
- expiry
- nonce replay protection
- plan tamper detection

### Execution path selection

- Without `guardContractAddress`, PreflightX signs the OKX DEX v6 route payload directly.
- With `guardContractAddress`, PreflightX does **not** sign raw OKX aggregator calldata. It requests a contract-compatible executable route from the Uniswap Trading API, binds that route to the guard as `swapper`, binds the original caller as recipient, and signs that executable route instead.
- OKX remains the quote-discovery, market-data, and token-risk source in both modes.

## The policy checks

`preflight.check(intent, limits)` runs these checks in order and short-circuits on first failure:

1. OKX DEX v6 route discovery
2. Uniswap cross-source divergence (`<= 50 bps`)
3. ERC-20 balance on X Layer
4. ERC-20 allowance against the configured approval target
5. Route payload sanity for execution
6. Token safety, risk level, holder concentration, and token age
7. Quoted slippage against `maxSlippageBps`
8. Price deviation versus recent candles
9. Upstream market-data freshness
10. Portfolio impact relative to the source-token balance
11. Optional gas-cost budget
12. EIP-712 signing of the guard-ready plan

## Returned objects

On success, the response contains:

- `plan`: the exact guard struct
- `quote`: descriptive route and policy metadata
- `signature`: EIP-712 signature over `plan`
- `signer`: attestation address

`plan` matches the Solidity struct exactly:

```ts
{
  caller,
  fromToken,
  toToken,
  fromAmount,
  minToAmount,
  router,
  callData,
  value,
  expiresAt,
  nonce,
}
```

## Minimal usage

```ts
import { Preflight, PlanSigner } from "preflightx-skill";

const preflight = new Preflight({
  onchainosApiKey: process.env.ONCHAINOS_API_KEY!,
  onchainosSecretKey: process.env.ONCHAINOS_SECRET_KEY!,
  onchainosPassphrase: process.env.ONCHAINOS_PASSPHRASE!,
  signerPrivateKey: process.env.PREFLIGHTX_SIGNER_PK as `0x${string}`,
  uniswapApiKey: process.env.UNISWAP_API_KEY,
  uniswapUniversalRouterVersion: process.env.UNISWAP_UNIVERSAL_ROUTER_VERSION as
    | "1.2"
    | "2.0"
    | "2.1.1"
    | undefined,
  guardContractAddress: process.env.PREFLIGHTGUARD_ADDRESS as `0x${string}` | undefined,
});

const result = await preflight.check(
  {
    action: "swap",
    fromToken: "0x...",
    toToken: "0x...",
    amount: "1000000",
    caller: "0xYourAgenticWallet",
  },
  {
    maxSlippageBps: 100,
    maxHolderConcentrationPct: 40,
    minTokenAgeSeconds: 86400,
    maxPortfolioImpactPct: 25,
    maxStaleQuoteSeconds: 60,
    maxGasCostWei: "400000000000000",
  },
);

if (result.verdict === "pass") {
  const recovered = await PlanSigner.verify(result.plan!, result.signature!);
  console.log("Recovered signer:", recovered);
}
```

## Environment

```bash
ONCHAINOS_API_KEY=...
ONCHAINOS_SECRET_KEY=...
ONCHAINOS_PASSPHRASE=...
PREFLIGHTX_SIGNER_PK=0x...
UNISWAP_API_KEY=...
PREFLIGHTGUARD_ADDRESS=0x...
UNISWAP_UNIVERSAL_ROUTER_VERSION=2.0
```

See [.env.example](./.env.example).

## Repository map

- `src/` - verifier, signer, route clients, chain helpers
- `contracts/` - on-chain guard contract
- `test/` - deterministic verifier and guard tests
- `scripts/` - deploy, demo, agent demo, signer generation
- `web/` - live demo app and API routes
- `docs/SUBMISSION.md` - concise submission-safe claims and deployment notes

## Security notes

- Use a dedicated deployer key and a separate attestation signer.
- Do not commit signer private keys.
- The previously published signer `0xd0C14e287fF6E0B0EC6591BC14FE66CB06FAa0AA` is retired and untrusted.
- The previously published guard `0xccaeeb946a0511e0a1fd4497dd6f4e59294478eb` is retired because it was bound to that compromised signer.

## Verification status

Current local status:

- `npm test` passes
- `npm run lint` passes
- `npm run build` passes
- `web/npm run build` passes

## License

MIT
