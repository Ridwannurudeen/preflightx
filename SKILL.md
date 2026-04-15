---
name: preflightx
description: "On-chain enforced pre-execution verification for autonomous DeFi agents on X Layer. Composes 8 OnchainOS endpoints (DEX, Onchain Gateway, Market, Wallet) with Uniswap AI for cross-source route validation and direct X Layer RPC reads for ERC-20 balance/allowance. Returns an EIP-712 signed VerifiedPlan that the PreflightGuard contract requires before forwarding any swap. Pipeline short-circuits on the first failure."
version: "0.2.0"
---

# PreflightX

**Run preflight before you trade. Enforce it on-chain.**

PreflightX is a Skill Arena entry for the OKX Build X Hackathon. Any DeFi agent on X Layer can call `preflight.check(intent, limits)` to get a single-shot verification across 8 OnchainOS endpoints + Uniswap AI + direct X Layer RPC reads. If every check passes, PreflightX returns a `VerifiedPlan` carrying a real EIP-712 signature from the published attestation key. The accompanying on-chain `PreflightGuard` contract only forwards a swap to the router if the signed plan is fresh, unused, and addressed to the caller — turning preflight from advisory check into an enforceable execution primitive.

Live deployment:
- Contract: [`0xccaeeb946a0511e0a1fd4497dd6f4e59294478eb`](https://www.oklink.com/xlayer/address/0xccaeeb946a0511e0a1fd4497dd6f4e59294478eb) (X Layer mainnet)
- Attestation signer: `0xd0C14e287fF6E0B0EC6591BC14FE66CB06FAa0AA`

## When to invoke

Trigger phrases:
- "preflight this trade"
- "verify this route"
- "is this swap safe"
- "check slippage"
- "audit this trade before I send it"
- "execute through PreflightGuard"

Use PreflightX **before any swap, route execution, or asset move** an autonomous agent intends to perform on X Layer (chainId `196`).

## What it does — the 11 internal steps

The verifier **short-circuits on the first failure** and returns a single reason code.

| # | Step | Surface |
|---|---|---|
| 1 | Route discovery (dual source) | OnchainOS DEX `quote` + Uniswap AI quote |
| 2 | Cross-source divergence (≤ 50 bps) | Comparison |
| 3 | ERC-20 balance ≥ amount | viem RPC `balanceOf` |
| 4 | ERC-20 allowance(router) ≥ amount | viem RPC `allowance` |
| 5 | Transaction simulation | OnchainOS Onchain Gateway `simulate-tx` |
| 6 | Token safety + holder concentration | OnchainOS Market `token-info` |
| 7 | Slippage envelope | (computed) |
| 7b | Price deviation vs recent candles (≤ 1000 bps) | OnchainOS Market `candles` + `price` |
| 8 | Quote freshness | (computed) |
| 9 | Portfolio policy | OnchainOS Wallet `total-value` + `all-token-balances` |
| 10 | Gas pricing | OnchainOS Onchain Gateway `gas-price` |

**OnchainOS v6 endpoints hit:** `/api/v6/dex/aggregator/swap` (single call returns route + calldata + router + min-receive + gas + honeypot flag + tax rate + unit price + decimals — the v6 aggregator runs routing/simulation/safety-lookups internally), `/api/v6/dex/market/candles` (recent OHLCV for price-deviation check). Plus Uniswap AI quote cross-validation + direct X Layer RPC `balanceOf` / `allowance` on the caller.

On pass: produces an EIP-712 signed `VerifiedPlan` with a 90-second TTL and a single-use nonce.

## Installation

```bash
npm install @preflightx/skill
```

## Quick start

```ts
import { Preflight, PlanSigner } from "@preflightx/skill";

const preflight = new Preflight({
  onchainosApiKey: process.env.ONCHAINOS_API_KEY!,
  onchainosSecretKey: process.env.ONCHAINOS_SECRET_KEY!,
  onchainosPassphrase: process.env.ONCHAINOS_PASSPHRASE!,
  signerPrivateKey: process.env.PREFLIGHTX_SIGNER_PK as `0x${string}`,
});

const result = await preflight.check(
  {
    action: "swap",
    fromToken: "0x...USDC",
    toToken: "0x...OKB",
    amount: "1000000000",
    caller: "0xYourAgenticWallet",
  },
  {
    maxSlippageBps: 100,
    maxHolderConcentrationPct: 50,
    minTokenAgeSeconds: 86400,
    maxPortfolioImpactPct: 25,
    maxStaleQuoteSeconds: 60,
  },
);

if (result.verdict === "pass") {
  // Verify signature off-chain
  const recovered = await PlanSigner.verify(
    result.plan!,
    100,
    result.signature!,
  );
  // Or pass result.plan + result.signature into PreflightGuard.executeWithPreflight
} else {
  console.log("Blocked:", result.failedReasonCodes);
}
```

## Output schema

```ts
type VerifyResponse = {
  verdict: "pass" | "fail";
  plan?: VerifiedPlan;        // present only on pass
  signature?: `0x${string}`;  // EIP-712 65-byte signature
  signer?: `0x${string}`;     // attestation signer address
  checks: CheckResult[];
  failedReasonCodes: ReasonCodeKey[];
  verifiedAt: number;
};
```

Reason codes: `ROUTE_NOT_FOUND`, `ROUTE_SIMULATION_FAILED`, `SLIPPAGE_EXCEEDED`, `TOKEN_UNSAFE`, `HOLDER_CONCENTRATION_TOO_HIGH`, `PRICE_DEVIATION_TOO_HIGH`, `PORTFOLIO_IMPACT_TOO_HIGH`, `GAS_INSUFFICIENT`, `STALE_QUOTE`, `CROSS_SOURCE_DIVERGENCE`, `INSUFFICIENT_BALANCE`, `INSUFFICIENT_ALLOWANCE`.

## Configuration

Required env:
- `ONCHAINOS_API_KEY` — from the [OnchainOS Dev Portal](https://web3.okx.com/onchainos/dev-portal)
- `ONCHAINOS_SECRET_KEY` — for HMAC SHA-256 signing
- `ONCHAINOS_PASSPHRASE` — passphrase set when API key was created
- `PREFLIGHTX_SIGNER_PK` — generated with `npm run gen-signer`

Optional env:
- `OKX_BASE_URL` (default `https://web3.okx.com`)
- `RPC_URL` (default `https://rpc.xlayer.tech`)

## On-chain enforcement

`PreflightGuard.executeWithPreflight(plan, signature)` reverts on:
- `InvalidSigner` — signature does not recover to the published attestation address
- `PlanExpired` — `block.timestamp > plan.expiresAt`
- `NonceUsed` — plan was already executed
- `CallerMismatch` — `msg.sender != plan.caller`
- `RouterCallFailed` — the underlying swap reverted
- `AmountOutBelowMin` — actual `amountOut < plan.minToAmount`

The `minToAmount` is computed from the verifier's quote and the caller's `maxSlippageBps`, then signed into the plan — so the slippage commitment is enforced on-chain, not just promised off-chain.

## Limits

- `VerifiedPlan` valid for **90 seconds** (`expiresAt`). Re-verify after expiry.
- Designed for single-hop swaps; multi-hop routing is delegated to OKX DEX aggregator's internal hop selection.
- Caller must approve `PreflightGuard` for `plan.fromAmount` of `plan.fromToken` before calling `executeWithPreflight`.
