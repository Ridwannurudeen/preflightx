---
name: preflightx
description: "Verify X Layer swaps before execution and sign the exact PreflightGuard plan struct that the contract enforces."
version: "0.3.0"
---

# PreflightX

Use this skill before executing a swap on X Layer.

## Trigger phrases

- "preflight this trade"
- "verify this route"
- "is this swap safe"
- "execute through PreflightGuard"

## What it does

The verifier checks:

1. OKX DEX v6 route discovery
2. Uniswap cross-source divergence
3. ERC-20 balance
4. ERC-20 allowance
5. Guard-executable route payload sanity
6. Token safety, concentration, and age
7. Slippage envelope
8. Price deviation vs candles
9. Market-data freshness
10. Portfolio impact
11. Optional gas-cost budget
12. EIP-712 signing of the guard-ready plan

## Output

On success it returns:

- `plan`: exact guard struct
- `quote`: descriptive route metadata
- `signature`: EIP-712 signature over `plan`
- `signer`: attestation address

## Configuration

Required env:

- `ONCHAINOS_API_KEY`
- `ONCHAINOS_SECRET_KEY`
- `ONCHAINOS_PASSPHRASE`
- `PREFLIGHTX_SIGNER_PK`

Optional env:

- `PREFLIGHTGUARD_ADDRESS`
- `RPC_URL`
- `OKX_BASE_URL`

## Operational notes

- If `PREFLIGHTGUARD_ADDRESS` is configured, allowance is checked against the guard.
- Do not commit the attestation private key.
- Rotate and redeploy any signer whose private key was previously exposed.
