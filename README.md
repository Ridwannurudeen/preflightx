# PreflightX

**On-chain enforced pre-execution verification for autonomous DeFi agents on X Layer.**

Built for the [OKX Build X Hackathon](https://web3.okx.com/xlayer/build-x-hackathon) — Skill Arena.

PreflightX is two things, used together:

1. **`@preflightx/skill`** — a TypeScript skill any agent installs. Exposes one function `preflight.check(intent, limits)` that runs ten programmatic checks across OnchainOS, Uniswap AI, and X Layer RPC. On pass it returns a `VerifiedPlan` carrying a real EIP-712 signature.
2. **`PreflightGuard`** — a Solidity contract on X Layer that only forwards a swap to the router if a fresh, unused, signed `VerifiedPlan` is presented. Bypassing PreflightX means losing the safety path.

Live deployment:
- Contract: [`0xccaeeb946a0511e0a1fd4497dd6f4e59294478eb`](https://www.oklink.com/xlayer/address/0xccaeeb946a0511e0a1fd4497dd6f4e59294478eb) (X Layer mainnet)
- Attestation signer: `0xd0C14e287fF6E0B0EC6591BC14FE66CB06FAa0AA`

## What's inside the single `preflight.check()` call

PreflightX composes **8 distinct OnchainOS endpoints** + Uniswap AI + direct X Layer RPC reads:

| Step | Surface | Check |
|---|---|---|
| 1 | OnchainOS DEX `quote` + Uniswap AI quote | Dual-source route discovery |
| 2 | (computed) | Cross-source divergence ≤ 50 bps |
| 3 | viem RPC `balanceOf` | Caller has sufficient `fromToken` |
| 4 | viem RPC `allowance` | Caller approved router for amount |
| 5 | OnchainOS Onchain Gateway `simulate-tx` | Tx doesn't revert |
| 6 | OnchainOS Market `token-info` | Token verified, holder concentration ≤ limit |
| 7 | (computed) | Quote slippage ≤ caller's `maxSlippageBps` |
| 7b | OnchainOS Market `candles` + `price` | Current price within 1000 bps of recent candle mean |
| 8 | (computed) | Quote age ≤ `maxStaleQuoteSeconds` |
| 9 | OnchainOS Wallet `total-value` + `all-token-balances` | Trade size ≤ portfolio impact cap |
| 10 | OnchainOS Onchain Gateway `gas-price` | Computes total estimated cost |

**OnchainOS endpoints hit (8 distinct):** `dex/aggregator/quote`, `dex/aggregator/onchain-gateway/simulate-tx`, `dex/aggregator/onchain-gateway/gas-price`, `dex/market/token-info`, `dex/market/price`, `dex/market/candles`, `wallet/asset/total-value`, `wallet/asset/all-token-balances`. Endpoints match OnchainOS `llms.txt` as of Apr 14 2026; if OKX migrates paths to `v6`, the skill surface is unaffected — only the underlying client paths need updating.

The pipeline **short-circuits on the first failure** and returns a single reason code. On full pass it returns a `VerifiedPlan` valid for 90 seconds, with a single-use nonce and an EIP-712 signature recoverable to the published signer.

## Why this is different

| Common pattern | PreflightX |
|---|---|
| Single-source quoter | Dual-source (OKX DEX + Uniswap AI) with divergence rejection |
| LLM-as-judge | Pure programmatic checks, every fail is a reason code |
| Hash called "signature" | Real EIP-712 signature, recoverable on-chain via `ecrecover` |
| Off-chain promise | On-chain `PreflightGuard` enforces the promise; bypass = no swap |

## Install

```bash
npm install @preflightx/skill
```

## Configure

```bash
# OnchainOS API credentials (all three required for HMAC signing)
ONCHAINOS_API_KEY=...
ONCHAINOS_SECRET_KEY=...
ONCHAINOS_PASSPHRASE=...

# PreflightX attestation key — generate with `npm run gen-signer`
PREFLIGHTX_SIGNER_PK=0x...
PREFLIGHTX_SIGNER_ADDRESS=0x...
```

See `.env.example`.

## Use

```ts
import { Preflight, PlanSigner } from "@preflightx/skill";

const preflight = new Preflight({
  onchainosApiKey: process.env.ONCHAINOS_API_KEY!,
  onchainosSecretKey: process.env.ONCHAINOS_SECRET_KEY!,
  onchainosPassphrase: process.env.ONCHAINOS_PASSPHRASE!,
  signerPrivateKey: process.env.PREFLIGHTX_SIGNER_PK as `0x${string}`,
});

const result = await preflight.check(intent, limits);

if (result.verdict === "pass") {
  // result.plan is signed, result.signature is EIP-712 recoverable to result.signer
  const recovered = await PlanSigner.verify(
    result.plan!,
    limits.maxSlippageBps,
    result.signature!,
  );
  console.log("Signer recovered:", recovered);
} else {
  console.log("Blocked:", result.failedReasonCodes);
}
```

To execute on-chain through the guard:

```solidity
PreflightGuard guard = PreflightGuard(0xccaeeb946a0511e0a1fd4497dd6f4e59294478eb);
// Caller must approve(guard, plan.fromAmount) on plan.fromToken first
guard.executeWithPreflight(plan, signature);
```

The guard reverts on `InvalidSigner`, `PlanExpired`, `NonceUsed`, `CallerMismatch`, `RouterCallFailed`, or `AmountOutBelowMin`.

## Architecture

```
intent + limits
      │
      ▼
┌───────────────────────────────────────────────────────────┐
│                Preflight.check()                           │
├───────────────────────────────────────────────────────────┤
│ 1.  OKX DEX quote     +  Uniswap AI quote (parallel)      │
│ 2.  Cross-source divergence check                         │
│ 3.  ERC-20 balanceOf via X Layer RPC                      │
│ 4.  ERC-20 allowance via X Layer RPC                      │
│ 5.  OKX Onchain Gateway simulate-tx                       │
│ 6.  OKX Market token-info (safety, concentration)         │
│ 7.  Slippage envelope                                     │
│ 8.  Quote freshness                                       │
│ 9.  OKX Wallet portfolio + balances                       │
│ 10. OKX Onchain Gateway gas-price                         │
│ 11. EIP-712 sign canonical plan                           │
└───────────────────────────────────────────────────────────┘
      │
      ▼
{ verdict, plan, signature, signer, checks[], failedReasonCodes[] }
      │
      ▼   (optional: enforce on-chain)
┌───────────────────────────────────────────────────────────┐
│           PreflightGuard.executeWithPreflight()           │
├───────────────────────────────────────────────────────────┤
│ 1. Verify EIP-712 signature recovers to PreflightX signer │
│ 2. Reject if expired                                      │
│ 3. Reject if nonce already used                           │
│ 4. Reject if caller != plan.caller                        │
│ 5. Pull funds, approve router, forward call               │
│ 6. Verify amountOut >= minToAmount                        │
│ 7. Emit PreflightExecuted                                 │
└───────────────────────────────────────────────────────────┘
```

## Project layout

```
preflightx/
├── plugin.yaml              # OKX plugin store manifest
├── SKILL.md                 # Skill description
├── package.json
├── tsconfig.json
├── contracts/
│   ├── PreflightGuard.sol   # On-chain enforcement contract
│   └── out/                 # Compiled artifacts
├── src/
│   ├── index.ts             # Public API
│   ├── verifier.ts          # 10-step composition (short-circuiting)
│   ├── signer.ts            # EIP-712 PlanSigner
│   ├── chain.ts             # X Layer RPC client + ERC-20 helpers
│   ├── onchainos.ts         # OnchainOS HMAC-signed client
│   ├── uniswap.ts           # Uniswap AI cross-validation
│   └── types.ts             # Zod schemas + EIP-712 types
├── test/
│   └── verifier.test.ts     # 8 tests, signature roundtrip + short-circuit
└── scripts/
    ├── gen-signer.ts        # Generate attestation keypair
    ├── compile.ts           # Compile PreflightGuard.sol
    ├── deploy.ts            # Deploy to X Layer
    └── demo.ts              # Run a real verification
```

## Scripts

```bash
npm run gen-signer    # generate a fresh PreflightX attestation key
npm run compile       # compile PreflightGuard.sol
npm run deploy        # deploy PreflightGuard to X Layer (deployer must be funded)
npm test              # run vitest suite (8 tests)
npm run demo          # run a real preflight against live X Layer + OnchainOS
```

## License

MIT
