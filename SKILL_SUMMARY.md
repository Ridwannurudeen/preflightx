# preflightx — Skill Summary

## Overview
PreflightX is a pre-execution verification skill for autonomous DeFi agents on X Layer. In a single call it composes 8 distinct OnchainOS endpoints (DEX quote, token info, market price, transaction simulation, gas price, wallet total-value, wallet balances, market candles) plus Uniswap AI's routing API to validate routes, slippage envelopes, token safety, portfolio policy, and quote freshness. Returns either a signed `VerifiedPlan` ready for execution or a structured list of failing reason codes — agents never send a doomed transaction.

## Usage
Install with `npm install @preflightx/skill`, instantiate with an OnchainOS API key, and call `preflight.check(intent, limits)` before any swap. The result is fully objective — no LLM-as-judge — so failures can be audited by humans or composed into on-chain settlement contracts via the keccak256 signature.

## Commands / API
| Method | Purpose |
|--------|---------|
| `new Preflight({ onchainosApiKey })` | Construct a verifier with caller's API key |
| `preflight.check(intent, limits)` | Run the 9-step verification pipeline |
| `IntentSchema.parse(...)` | Validate intent shape with zod |
| `RiskLimitsSchema.parse(...)` | Validate risk-limit shape with zod |

## Triggers
Activates when an agent is about to swap, route, or move assets on X Layer (chainId 196) and wants a pre-execution safety check. Trigger phrases: "preflight this trade", "verify route", "is this swap safe", "check slippage", "validate execution plan", "audit this trade".
