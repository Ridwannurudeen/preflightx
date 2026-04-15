# Submission Notes

Use the updated repository state as the source of truth.

## Rotated deployment (X Layer mainnet, chainId 196)

- **PreflightGuard (current):** `0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb`
  - Deploy tx: `0x5986429bf92a6e5760c9f49a021984b7a224cc5945716fe2daa347aa2f661e80`
  - Explorer: https://www.oklink.com/xlayer/address/0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb
- **Attestation signer (current):** `0xeD964c21317fab45105Ac20C97a061DbBfBE8412`
- **Deployer wallet:** `0x894f6d4d3a7cFF40aeFD63Ac3794358E38a3dDc3`
  - Funded from Agentic Wallet by tx: `0xfa4c96ad053e68cd578b9b8d90277550f32b21723a2d3feea12a84dbfb89ab80`
- **USDC approval to current guard:** `0xe9ca40d55bb3e77fe83ee351a29e84d64cadce41b56b470d668e355d402b0c38`

## Retired deployment

- **Previous PreflightGuard:** `0xccaeeb946a0511e0a1fd4497dd6f4e59294478eb` — retired. Its immutable signer's private key was exposed in early git history. Do not rely on this address.
- **Previous signer:** `0xd0C14e287fF6E0B0EC6591BC14FE66CB06FAa0AA` — compromised. Treat any signature recoverable to this address as untrusted.

## Current implementation claims that are safe to make

- The verifier returns the exact guard-ready plan struct (flat `{caller, fromToken, toToken, fromAmount, minToAmount, router, callData, value, expiresAt, nonce}`).
- The signature covers `minToAmount`; there is no hidden slippage reconstruction step.
- The verifier checks balance, allowance (targeting the configured guard when present), route payload sanity, token safety, holder concentration, token age, slippage, price deviation, market-data freshness, portfolio impact, and optional gas budget.
- Signatures are recoverable to the published signer via `PreflightGuard.verifySignature(plan, signature)` on-chain.
- The guard rejects invalid, expired, replayed, tampered, or wrong-caller plans at the enforcement layer.
- The local test suite is deterministic and passes fully (19 tests).

## Known limitations disclosed honestly

- End-to-end guarded execution through the OKX v6 aggregator reverts with `RouterCallFailed`. The v6 aggregator compiles calldata for an EOA caller and is not designed to be invoked from an intermediary contract. The guard's signature/expiry/nonce/caller/tamper layers remain enforced regardless of router. To execute swaps end-to-end through the guard today, use a router that accepts intermediary callers (e.g. Uniswap V2/V3-style).

## What the submission does not claim

- A production-ready end-to-end guarded swap through the OKX v6 aggregator.
- That the retired guard or retired signer have any remaining trust.
