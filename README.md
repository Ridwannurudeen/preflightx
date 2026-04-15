# PreflightX

PreflightX is a TypeScript verifier plus an optional Solidity guard for X Layer swaps.

It verifies a proposed swap against live state, then signs the exact `PreflightGuard.executeWithPreflight` plan struct that the contract expects. The returned `plan` is guard-ready as-is; no hidden reconstruction step is required.

## What it checks

`preflight.check(intent, limits)` runs these checks in order and short-circuits on the first failure:

1. OKX DEX v6 route discovery
2. Uniswap cross-source divergence (`<= 50 bps`)
3. ERC-20 balance on X Layer
4. ERC-20 allowance against the configured approval target
5. Route payload sanity for guard execution
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

# Optional but recommended when you intend to execute through the guard
PREFLIGHTGUARD_ADDRESS=0x...
```

## Use

```ts
import { Preflight, PlanSigner } from "@preflightx/skill";

const preflight = new Preflight({
  onchainosApiKey: process.env.ONCHAINOS_API_KEY!,
  onchainosSecretKey: process.env.ONCHAINOS_SECRET_KEY!,
  onchainosPassphrase: process.env.ONCHAINOS_PASSPHRASE!,
  signerPrivateKey: process.env.PREFLIGHTX_SIGNER_PK as `0x${string}`,
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

### Router compatibility

`executeWithPreflight` pulls the caller's funds into the guard, approves the router in `plan.router`, and forwards `plan.callData`. This works with routers that execute against `msg.sender` as the funding party. The OKX v6 aggregator compiles calldata for the originating EOA as caller and is **not** designed to be invoked from an intermediary contract; guarded execution against that aggregator will revert with `RouterCallFailed`. To execute end-to-end through the guard, use a router that accepts intermediary callers (most standard DEX routers such as Uniswap V2/V3 do). The signature, expiry, nonce, caller binding, and tamper detection layers of the guard are router-agnostic and enforced regardless.

## Security notes

- Do not commit the attestation private key.
- Use a dedicated deployer key and a separate attestation signer in production.
- Treat any previously published signer whose private key was exposed as compromised and redeploy the guard with a rotated signer.

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
