# PreflightX

**The safety and execution policy layer for autonomous trading agents on X Layer.** PreflightX doesn't just detect risk — it decides, explains, remediates, and produces a signed, on-chain-verifiable attestation that any execution contract can gate on.

- **Live demo:** https://preflight.gudman.xyz
- **Current guard (X Layer mainnet):** [`0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb`](https://www.oklink.com/xlayer/address/0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb)
- **Current attestation signer:** [`0xeD964c21317fab45105Ac20C97a061DbBfBE8412`](https://www.oklink.com/xlayer/address/0xeD964c21317fab45105Ac20C97a061DbBfBE8412)
- **Track:** OKX Build X · Skill Arena

## What it is

A TypeScript verifier plus a Solidity guard. An agent calls `preflight.check(intent, limits)` before every swap; the verifier composes the OKX DEX v6 aggregator, OKX market candles, direct X Layer RPC reads (`balanceOf`, `allowance`), and the Uniswap Trading API into eleven deterministic, numeric policy checks. On pass, it returns the exact `PreflightGuard.executeWithPreflight` plan struct — already signed with EIP-712 so the contract accepts it as-is.

## The agent loop

```
agent intent  ─►  preflight.check()  ─►  pass?
                       │                  ├── yes ─►  signed guard-ready plan  ─►  execute
                       │                  └── no  ─►  reason code + details
                       │                                   │
                       └─◄───────────  remediate  ◄────────┘
                           (resize, widen, approve, reroute)
```

- **Deterministic.** Every fail is a reason code (`INSUFFICIENT_BALANCE`, `SLIPPAGE_EXCEEDED`, `HOLDER_CONCENTRATION_TOO_HIGH`, …) — no LLM-as-judge.
- **Autonomous.** The agent loop resolves recoverable failures without human review: resize to live balance, widen slippage within a cap, issue missing approvals, halve impact.
- **Enforced on-chain.** The signed plan is recoverable to the published signer via `PreflightGuard.verifySignature()`; the guard rejects expired, replayed, tampered, or wrong-caller plans.

## Agent demo

A one-command end-to-end demonstration on X Layer mainnet:

```bash
npm install
npm run agent-demo
```

The script walks through: aggressive intent → preflight BLOCKED with plain-English reasoning → autonomous remediation → re-check PASS with signed plan → on-chain signature verification via `PreflightGuard.verifySignature` → real X Layer approval transaction → post-trade report with block explorer links.

Run it yourself; every tx hash it prints is live on X Layer mainnet.

## The eleven checks

`preflight.check(intent, limits)` runs these in order and short-circuits on the first failure:

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

On success the response contains:

- `plan`: the exact guard struct
- `quote`: descriptive route and policy metadata
- `signature`: EIP-712 signature over `plan`
- `signer`: attestation address

`plan` matches the Solidity struct:

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

## Install

```bash
npm install @preflightx/skill
```

## Configure

```bash
ONCHAINOS_API_KEY=...
ONCHAINOS_SECRET_KEY=...
ONCHAINOS_PASSPHRASE=...
PREFLIGHTX_SIGNER_PK=0x...

# Optional for direct non-guard signing.
# If omitted, Uniswap cross-checks are skipped unless you configure a guard path below.
UNISWAP_API_KEY=...

# Recommended when you intend to execute through the guard.
PREFLIGHTGUARD_ADDRESS=0x...
UNISWAP_UNIVERSAL_ROUTER_VERSION=2.0
```

## Use

```ts
import { Preflight, PlanSigner } from "@preflightx/skill";

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

## Guard execution

The returned `plan` is accepted as-is by the guard contract's verification surface:

```solidity
PreflightGuard guard = PreflightGuard(guardAddress);
address recovered = guard.verifySignature(plan, signature); // recovers the attestation signer
guard.executeWithPreflight(plan, signature);                // invokes the signed router call
```

If you configure `guardContractAddress` in the verifier, the allowance check targets the guard instead of the downstream router.

### Execution path selection

- Without `guardContractAddress`, PreflightX signs the OKX DEX v6 route payload directly.
- With `guardContractAddress`, PreflightX does not sign OKX aggregator calldata. It requests a contract-compatible executable route from the Uniswap Trading API, binds that route to the guard as `swapper`, binds the original caller as recipient, and signs that executable route instead.
- OKX remains the quote-discovery, market-data, and token-risk source in both modes. Uniswap is used as the cross-source quote and, in guard mode, as the execution path.

This removes the earlier intermediary-router incompatibility: guarded execution no longer relies on OKX v6 aggregator calldata that expects the originating EOA as caller.

## Security notes

- Do not commit the attestation private key.
- Use a dedicated deployer key and a separate attestation signer in production.
- The previously published signer `0xd0C14e287fF6E0B0EC6591BC14FE66CB06FAa0AA` had its private key exposed in early git history and has been **retired**. The previously published guard `0xccaeeb946a0511e0a1fd4497dd6f4e59294478eb`, which was bound to that signer in its immutable constructor, is also retired.
- The current attestation signer is `0xeD964c21317fab45105Ac20C97a061DbBfBE8412`; the current guard is `0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb` (X Layer mainnet, chainId 196).

## Scripts

```bash
npm run gen-signer
npm run compile
npm run deploy
npm test
npm run demo
```

## Verification status

Current local status:

- `npm test` passes
- `npm run lint` passes
- `npm run build` passes

## License

MIT
