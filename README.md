# PreflightX

[![npm](https://img.shields.io/npm/v/preflightx-skill?color=00E08F&label=npm)](https://www.npmjs.com/package/preflightx-skill)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-21%20passing-00E08F)](#tests)
[![Chain](https://img.shields.io/badge/X%20Layer-mainnet%20(196)-blue)](https://www.oklink.com/xlayer)
[![Guard](https://img.shields.io/badge/PreflightGuard-deployed-00E08F)](https://www.oklink.com/xlayer/address/0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb)
[![Demo](https://img.shields.io/badge/demo-asciinema-ff5f56)](https://asciinema.org/a/MlnxQZtRAilxfqgq)

**Safety and execution policy layer for autonomous trading agents on X Layer.**
Stops unsafe swaps, explains the block, auto-remediates, and returns a signed on-chain-verifiable plan that [`PreflightGuard`](https://www.oklink.com/xlayer/address/0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb) enforces.

> Built for **OKX Build X Hackathon — Skill Arena** | [Live demo](https://preflight.gudman.xyz) | [Terminal recording](https://asciinema.org/a/MlnxQZtRAilxfqgq) | [npm](https://www.npmjs.com/package/preflightx-skill)

---

## Table of contents

- [Getting started](#getting-started)
- [How it works](#how-it-works)
- [The eleven checks](#the-eleven-checks)
- [Agent demo](#agent-demo)
- [Architecture](#architecture)
- [API reference](#api-reference)
- [Comparison](#comparison)
- [On-chain artifacts](#on-chain-artifacts)
- [Security](#security)
- [Tests](#tests)
- [License](#license)

---

## Getting started

### Install

```bash
npm install preflightx-skill
```

### Quick usage

```ts
import { Preflight } from "preflightx-skill";

const preflight = new Preflight({
  onchainosApiKey: process.env.ONCHAINOS_API_KEY!,
  onchainosSecretKey: process.env.ONCHAINOS_SECRET_KEY!,
  onchainosPassphrase: process.env.ONCHAINOS_PASSPHRASE!,
  signerPrivateKey: process.env.PREFLIGHTX_SIGNER_PK as `0x${string}`,
});

const result = await preflight.check(
  { action: "swap", fromToken: USDC, toToken: OKB, amount: "1000000", caller: WALLET },
  { maxSlippageBps: 100, maxHolderConcentrationPct: 40, maxPortfolioImpactPct: 25, maxStaleQuoteSeconds: 60 },
);

if (result.verdict === "pass") {
  // result.plan is guard-ready; result.signature is EIP-712
}
```

### Environment variables

```bash
ONCHAINOS_API_KEY=...
ONCHAINOS_SECRET_KEY=...
ONCHAINOS_PASSPHRASE=...
PREFLIGHTX_SIGNER_PK=0x...             # attestation signer (never commit)
PREFLIGHTGUARD_ADDRESS=0x...            # optional: enables guard-mode routing
UNISWAP_API_KEY=...                     # optional: enables cross-source + guard-mode routes
UNISWAP_UNIVERSAL_ROUTER_VERSION=2.0    # optional
```

See [`.env.example`](./.env.example) for a template.

---

## How it works

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

1. **Deterministic.** Every block is a reason code (`INSUFFICIENT_BALANCE`, `SLIPPAGE_EXCEEDED`, `HOLDER_CONCENTRATION_TOO_HIGH`, etc.). No LLM-as-judge.
2. **Autonomous.** The agent loop resolves recoverable failures: resize to live balance, widen slippage within a cap, issue missing approvals.
3. **Enforced.** The signed plan is recoverable via `PreflightGuard.verifySignature()` on-chain. The guard rejects expired, replayed, tampered, or wrong-caller plans.
4. **Composed.** OKX DEX v6 + OKX market candles + Uniswap Trading API cross-check + direct X Layer RPC reads + EIP-712 signing — not a single-API wrapper.

---

## The eleven checks

`preflight.check(intent, limits)` runs in order and short-circuits on first failure:

| # | Check | Source | Blocks when |
|---|---|---|---|
| 1 | Route discovery | OKX DEX v6 aggregator | no viable route |
| 2 | Cross-source divergence | Uniswap Trading API | OKX vs Uniswap > 50 bps |
| 3 | ERC-20 balance | X Layer RPC `balanceOf` | balance < intent amount |
| 4 | ERC-20 allowance | X Layer RPC `allowance` | allowance < intent amount |
| 5 | Route payload sanity | calldata inspection | malformed or missing fields |
| 6 | Token safety | OKX aggregator metadata | honeypot, high concentration, too new |
| 7 | Slippage envelope | OKX quote | quoted bps > `maxSlippageBps` |
| 8 | Price deviation | OKX market candles | current price > 1000 bps from recent mean |
| 9 | Market-data freshness | OKX timestamp | data older than `maxStaleQuoteSeconds` |
| 10 | Portfolio impact | balance + unit price | trade USD > `maxPortfolioImpactPct` of balance |
| 11 | Gas budget | OKX gas estimate | estimated cost > `maxGasCostWei` |

On pass: EIP-712 signed `VerifiedPlan` matching the `PreflightGuard` Solidity struct.

---

## Agent demo

One-command autonomous rescue on X Layer mainnet:

```bash
npm install
AGENT_DEMO_MODE=direct npm run agent-demo
```

**What happens:**

1. Agent proposes `1.0 USDC -> USDT` (more than the wallet holds)
2. PreflightX blocks: `INSUFFICIENT_BALANCE`
3. Agent reasons in plain English, resizes to 90% of live balance
4. PreflightX re-runs, returns `PASS` with signed plan
5. `PreflightGuard.verifySignature()` confirms the signer on-chain
6. Swap executes atomically via OnchainOS Agentic Wallet

**Verified rescue tx:** [`0x9d746524...7e7e`](https://www.oklink.com/xlayer/tx/0x9d746524c2079d0eaa7d8bc7240c6d2b6a74454cefb15e5b48d67bfebe3b7e7e) — USDC `0.1011 -> 0.0101`, delta matches exactly.

**Terminal recording:** https://asciinema.org/a/MlnxQZtRAilxfqgq

---

## Architecture

### Off-chain verifier (`src/verifier.ts`)

Composes:
- **OKX DEX v6** — route, calldata, token safety, holder concentration, token age, unit price
- **OKX market candles** — OHLCV for price deviation
- **Uniswap Trading API** — cross-source validation + guard-compatible executable routes
- **X Layer RPC** — `balanceOf`, `allowance`, `verifySignature`
- **EIP-712 signing** — plan attestation

### On-chain guard (`contracts/PreflightGuard.sol`)

Enforces: signer recovery, caller binding, expiry, nonce replay protection, plan tamper detection.

### Execution path selection

| Mode | Signed route source | Approval target | Use case |
|---|---|---|---|
| Without `guardContractAddress` | OKX DEX v6 | OKX router | Direct EOA execution |
| With `guardContractAddress` | Uniswap Trading API | Guard contract | Guard-mediated execution |

OKX remains the quote-discovery and risk-data source in both modes.

---

## API reference

### `preflight.check(intent, limits) -> VerifyResponse`

**Intent:**

```ts
{ action: "swap", fromToken: string, toToken: string, amount: string, caller: string }
```

**Limits:**

```ts
{
  maxSlippageBps: number,
  maxHolderConcentrationPct: number,
  minTokenAgeSeconds: number,
  maxPortfolioImpactPct: number,
  maxStaleQuoteSeconds: number,
  maxGasCostWei?: string,
}
```

**Response (on pass):**

| Field | Type | Description |
|---|---|---|
| `verdict` | `"pass"` | all checks passed |
| `plan` | `VerifiedPlan` | exact guard struct (caller, fromToken, toToken, fromAmount, minToAmount, router, callData, value, expiresAt, nonce) |
| `quote` | `QuoteSummary` | route metadata, approval target, token info |
| `signature` | `string` | EIP-712 signature over `plan` |
| `signer` | `string` | attestation address |

**Response (on fail):**

| Field | Type | Description |
|---|---|---|
| `verdict` | `"fail"` | at least one check failed |
| `failedReasonCodes` | `string[]` | e.g. `["INSUFFICIENT_BALANCE"]` |
| `checks` | `CheckResult[]` | per-check pass/fail with details |

---

## Comparison

| Capability | PreflightX | Advisory (Blockaid-style) | Safety-score (Guardian-style) | Intent control (Mandate-style) |
|---|---|---|---|---|
| On-chain enforcement contract | Yes | No | No | Partial |
| EIP-712 signed plan | Yes | No | No | No |
| Cross-source validation | Yes | Rarely | No | No |
| Autonomous remediation | Yes | No | No | Yes |
| Signer recoverable on-chain | Yes | No | No | No |
| Real agent-initiated swap tx | [Yes](https://www.oklink.com/xlayer/tx/0x9d746524c2079d0eaa7d8bc7240c6d2b6a74454cefb15e5b48d67bfebe3b7e7e) | — | — | — |

Most safety skills **warn**. PreflightX produces a cryptographic receipt the guard verifies on-chain.

---

## On-chain artifacts

| Artifact | Address / Hash |
|---|---|
| PreflightGuard | [`0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb`](https://www.oklink.com/xlayer/address/0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb) |
| Attestation signer | [`0xeD964c21317fab45105Ac20C97a061DbBfBE8412`](https://www.oklink.com/xlayer/address/0xeD964c21317fab45105Ac20C97a061DbBfBE8412) |
| Guard deploy tx | [`0x5986429b...1e80`](https://www.oklink.com/xlayer/tx/0x5986429bf92a6e5760c9f49a021984b7a224cc5945716fe2daa347aa2f661e80) |
| Agent rescue swap tx | [`0x9d746524...7e7e`](https://www.oklink.com/xlayer/tx/0x9d746524c2079d0eaa7d8bc7240c6d2b6a74454cefb15e5b48d67bfebe3b7e7e) |
| Agentic Wallet | [`0xefb90722a4731c01d64adb11e4dd8d76dd73911e`](https://www.oklink.com/xlayer/address/0xefb90722a4731c01d64adb11e4dd8d76dd73911e) |

---

## Security

- Do not commit the attestation private key.
- Use a dedicated deployer key separate from the attestation signer.
- The previously published signer `0xd0C14e287fF6E0B0EC6591BC14FE66CB06FAa0AA` and guard `0xccaeeb946a0511e0a1fd4497dd6f4e59294478eb` are **retired** — their private key was exposed in early git history and has been rotated.

---

## Repository map

```
src/            verifier, signer, OKX client, Uniswap client, chain helpers
contracts/      PreflightGuard.sol + compiled artifact
test/           deterministic verifier and guard tests
scripts/        deploy, demo, agent-demo, signer generation
web/            Next.js live demo app + API routes
```

---

## Tests

```bash
npm test        # 21 tests (verifier unit + guard on-chain behavior)
npm run lint    # TypeScript strict
npm run build   # SDK dist
cd web && npm run build   # web app
```

---

## License

MIT
