# preflightx — Skill Summary

## Overview
PreflightX is a pre-execution verification skill for autonomous DeFi agents on X Layer. In a single call it composes the OKX DEX v6 aggregator (route, calldata, token safety, holder concentration, token age) and the OKX market candles endpoint with Uniswap AI's routing API and direct X Layer RPC reads (ERC-20 `balanceOf`, `allowance`) to validate balance, allowance, route payload sanity, token safety, holder concentration, token age, slippage, price deviation, market-data freshness, portfolio impact, and optional gas-cost budget. Returns either a signed guard-ready `VerifiedPlan` or a structured list of failing reason codes — agents never send a doomed transaction.

## Usage
Install with `npm install preflightx-skill`, instantiate with an OnchainOS API key plus an attestation signer private key, and call `preflight.check(intent, limits)` before any swap. The result is fully objective — no LLM-as-judge — so failures can be audited by humans. On pass, the returned `plan` matches the `PreflightGuard` Solidity struct exactly and the EIP-712 signature is recoverable to the published signer address on-chain.

## Commands / API
| Method | Purpose |
|--------|---------|
| `new Preflight({ onchainosApiKey, onchainosSecretKey, onchainosPassphrase, signerPrivateKey, guardContractAddress? })` | Construct a verifier |
| `preflight.check(intent, limits)` | Run the verification pipeline and sign the plan |
| `PlanSigner.verify(plan, signature)` | Recover the signer from a signed plan |
| `IntentSchema.parse(...)` | Validate intent shape with zod |
| `RiskLimitsSchema.parse(...)` | Validate risk-limit shape with zod |

## Triggers
Activates when an agent is about to swap, route, or move assets on X Layer (chainId 196) and wants a pre-execution safety check. Trigger phrases: "preflight this trade", "verify route", "is this swap safe", "check slippage", "validate execution plan", "audit this trade".
