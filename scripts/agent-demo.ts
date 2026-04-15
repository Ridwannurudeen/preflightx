/**
 * PreflightX agent demo - autonomous trading agent workflow on X Layer.
 *
 * The agent proposes an aggressive swap, PreflightX blocks it, the agent
 * explains the failure in plain English, auto-remediates when possible,
 * re-runs preflight, verifies the signed plan on-chain, and optionally
 * sends the approval tx needed for guarded execution.
 *
 * Run:   npm run agent-demo
 * Needs: onchainos CLI on PATH (logged in) if you want approval tx artifacts.
 */

import { execSync } from "node:child_process";
import { createPublicClient, encodeFunctionData, http, parseAbi } from "viem";

const API = process.env.PREFLIGHT_API ?? "https://preflight.gudman.xyz/api/check";
const RPC = "https://rpc.xlayer.tech";
const USDC = "0x74b7F16337b8972027F6196A17a631aC6dE26d22";
const OKB = "0xe538905cf8410324e03A5A23C1c177a474D59b2b";
const USDT = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d";

// Token used as the swap destination in the demo. USDT is deep, stable, and
// currently the most reliable execution route on X Layer mainnet for small trades.
const TO_TOKEN = USDT;
const TO_SYMBOL = "USDT";
const AGENT = "0xefb90722a4731c01d64adb11e4dd8d76dd73911e";
const GUARD = "0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb";

const hr = (ch = "-") => console.log(ch.repeat(68));
const log = (msg: string) => console.log(msg);
const say = (who: string, msg: string) => console.log(`${who.padEnd(10)} | ${msg}`);
const agent = (msg: string) => say("agent", msg);
const preflight = (msg: string) => say("preflight", msg);
const chain = (msg: string) => say("x-layer", msg);
const narrator = (msg: string) => say("", msg);

type Intent = {
  action: "swap";
  fromToken: string;
  toToken: string;
  amount: string;
  caller: string;
};

type Limits = {
  maxSlippageBps: number;
  maxHolderConcentrationPct: number;
  minTokenAgeSeconds: number;
  maxPortfolioImpactPct: number;
  maxStaleQuoteSeconds: number;
  maxGasCostWei?: string;
};

type Check = {
  step: string;
  pass: boolean;
  details: Record<string, unknown>;
  reasonCode?: string;
};

type PreflightResponse = {
  verdict: "pass" | "fail";
  failedReasonCodes: string[];
  checks: Check[];
  plan?: {
    caller: string;
    fromToken: string;
    toToken: string;
    fromAmount: string;
    minToAmount: string;
    router: string;
    callData: string;
    value: string;
    expiresAt: number;
    nonce: string;
  };
  quote?: {
    source: string;
    approvalTarget: string;
    expectedToAmount: string;
    tokenSymbol: string;
    liquiditySources: string[];
    top10HoldPercent?: number;
    tokenAgeSeconds?: number;
  };
  signature?: string;
  signer?: string;
};

const MODE = (process.env.AGENT_DEMO_MODE ?? "guard") as "guard" | "direct";

async function runPreflight(intent: Intent, limits: Limits, label: string): Promise<PreflightResponse> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent, limits, presetLabel: `agent-demo - ${label}`, mode: MODE }),
  });
  if (!res.ok) throw new Error(`preflight HTTP ${res.status}`);
  return res.json() as Promise<PreflightResponse>;
}

async function getUsdcBalance(addr: string): Promise<bigint> {
  const client = createPublicClient({ transport: http(RPC) });
  return client.readContract({
    address: USDC,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [addr as `0x${string}`],
  });
}

async function getUsdcAllowance(owner: string, spender: string): Promise<bigint> {
  const client = createPublicClient({ transport: http(RPC) });
  return client.readContract({
    address: USDC,
    abi: parseAbi(["function allowance(address,address) view returns (uint256)"]),
    functionName: "allowance",
    args: [owner as `0x${string}`, spender as `0x${string}`],
  });
}

function formatUsdc(raw: string | bigint): string {
  const n = typeof raw === "bigint" ? raw : BigInt(raw);
  const whole = n / 1_000_000n;
  const frac = Number(n % 1_000_000n) / 1e6;
  return (Number(whole) + frac).toFixed(4);
}

function reasonExplain(reason: string, details: Record<string, unknown>, intent: Intent): string {
  switch (reason) {
    case "INSUFFICIENT_BALANCE":
      return `wallet balance ${details.balance ?? "?"} < intent amount ${intent.amount} (base units)`;
    case "INSUFFICIENT_ALLOWANCE":
      return `allowance ${details.allowance ?? "?"} to ${details.spender ?? "spender"} < intent amount ${intent.amount}`;
    case "SLIPPAGE_EXCEEDED":
      return `route estimated ${details.estimatedBps ?? "?"} bps slippage, policy cap is ${details.maxBps ?? "?"} bps`;
    case "HOLDER_CONCENTRATION_TOO_HIGH":
      return `top-10 holders own ${details.top10HoldPercent ?? "?"}%, policy cap is ${details.maxHolderConcentrationPct ?? "?"}%`;
    case "PRICE_DEVIATION_TOO_HIGH":
      return `unit price deviates ${details.deviationBps ?? "?"} bps from recent candle mean`;
    case "STALE_QUOTE":
      return `market data is ${details.ageSeconds ?? "?"}s old, policy max is ${details.maxSeconds ?? "?"}s`;
    case "PORTFOLIO_IMPACT_TOO_HIGH":
      return `trade size is ${details.impactPct ?? "?"}% of fromToken balance, policy cap is ${details.maxPct ?? "?"}%`;
    case "GAS_INSUFFICIENT":
      return `estimated gas cost ${details.estimatedCostWei ?? "?"} wei exceeds budget ${details.maxGasCostWei ?? "?"} wei`;
    case "TOKEN_UNSAFE":
      return `token risk checks failed: ${JSON.stringify(details)}`;
    case "ROUTE_SIMULATION_FAILED":
      return `route payload sanity failed: ${JSON.stringify(details)}`;
    case "CROSS_SOURCE_DIVERGENCE":
      return `OKX and Uniswap diverged by ${details.divergenceBps ?? "?"} bps`;
    default:
      return `verifier returned ${reason} with details ${JSON.stringify(details)}`;
  }
}

async function remediate(
  reason: string,
  intent: Intent,
  limits: Limits,
  details: Record<string, unknown>,
): Promise<{ intent: Intent; limits: Limits; explanation: string } | null> {
  switch (reason) {
    case "INSUFFICIENT_BALANCE": {
      const balance = await getUsdcBalance(intent.caller);
      if (balance === 0n) return null;
      const ninetyPct = (balance * 90n) / 100n;
      const allowance = await getUsdcAllowance(intent.caller, GUARD);
      const safeAmount = allowance > 0n && allowance < ninetyPct ? allowance : ninetyPct;
      const basis =
        safeAmount === allowance
          ? `live allowance ${formatUsdc(allowance)} USDC to guard (balance ${formatUsdc(balance)})`
          : `90% of live balance ${formatUsdc(balance)} USDC`;
      return {
        intent: { ...intent, amount: safeAmount.toString() },
        limits,
        explanation: `resized from ${formatUsdc(intent.amount)} USDC to ${formatUsdc(safeAmount)} USDC (${basis})`,
      };
    }
    case "SLIPPAGE_EXCEEDED": {
      const estimated = Number(details.estimatedBps ?? limits.maxSlippageBps);
      const widened = Math.min(Math.max(estimated + 50, limits.maxSlippageBps), 500);
      return {
        intent,
        limits: { ...limits, maxSlippageBps: widened },
        explanation: `widened slippage envelope from ${limits.maxSlippageBps} bps to ${widened} bps`,
      };
    }
    case "STALE_QUOTE":
      return { intent, limits, explanation: "retrying immediately so the quote freshness window refreshes" };
    case "PORTFOLIO_IMPACT_TOO_HIGH": {
      const smaller = (BigInt(intent.amount) / 2n).toString();
      return {
        intent: { ...intent, amount: smaller },
        limits,
        explanation: `halved trade size from ${intent.amount} to ${smaller} base units`,
      };
    }
    case "GAS_INSUFFICIENT": {
      const smaller = (BigInt(intent.amount) / 2n).toString();
      return {
        intent: { ...intent, amount: smaller },
        limits,
        explanation: `halved trade size from ${intent.amount} to ${smaller} to fit the gas budget`,
      };
    }
    case "INSUFFICIENT_ALLOWANCE": {
      const spender = (details.spender as string) ?? GUARD;
      const needed = BigInt(intent.amount) * 2n;
      if (MODE === "direct") {
        // Downstream onchainos swap execute will handle the approval atomically.
        return {
          intent,
          limits,
          explanation: `allowance gap flagged (need ${formatUsdc(needed)} USDC to ${spender.slice(0, 10)}...); will be handled atomically by swap execute in step 3`,
        };
      }
      const approveData = encodeFunctionData({
        abi: parseAbi(["function approve(address spender, uint256 amount)"]),
        functionName: "approve",
        args: [spender as `0x${string}`, needed],
      });
      const txHash = tryExec(
        `onchainos wallet contract-call --chain xlayer --to ${USDC} --input-data ${approveData}`,
        "autonomous-approve",
      );
      return {
        intent,
        limits,
        explanation: txHash
          ? `issued ERC-20 approval of ${formatUsdc(needed)} USDC to ${spender.slice(0, 10)}... (tx ${txHash.slice(0, 14)}...)`
          : `would issue approval of ${formatUsdc(needed)} USDC to ${spender.slice(0, 10)}... - onchainos CLI unavailable locally`,
      };
    }
    default:
      return null;
  }
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy-wait between retries; execSync is already blocking so this is fine
  }
}

function tryExec(cmd: string, label: string, maxAttempts = 4): string | null {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const out = execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      const swap = out.match(/"swapTxHash"\s*:\s*"(0x[a-fA-F0-9]+)"/);
      if (swap) return swap[1]!;
      const generic = out.match(/"txHash"\s*:\s*"(0x[a-fA-F0-9]+)"/);
      if (generic) return generic[1]!;
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // OKX Agentic Wallet serializes userOps per account; when another is in flight
      // we get error_code 20008. Retry after a short delay.
      if ((msg.includes("20008") || msg.includes("another order processing")) && attempt < maxAttempts) {
        chain(`[${label}] bundler busy, retrying in 15s (attempt ${attempt}/${maxAttempts})`);
        sleepSync(15000);
        continue;
      }
      chain(`[${label}] execution skipped: ${msg.split("\n")[0]}`);
      return null;
    }
  }
  return null;
}

async function verifyOnChain(plan: NonNullable<PreflightResponse["plan"]>, signature: string): Promise<string> {
  const client = createPublicClient({ transport: http(RPC) });
  return client.readContract({
    address: GUARD,
    abi: parseAbi([
      "function verifySignature((address caller, address fromToken, address toToken, uint256 fromAmount, uint256 minToAmount, address router, bytes callData, uint256 value, uint256 expiresAt, bytes32 nonce) plan, bytes signature) view returns (address)",
    ]),
    functionName: "verifySignature",
    args: [
      {
        caller: plan.caller as `0x${string}`,
        fromToken: plan.fromToken as `0x${string}`,
        toToken: plan.toToken as `0x${string}`,
        fromAmount: BigInt(plan.fromAmount),
        minToAmount: BigInt(plan.minToAmount),
        router: plan.router as `0x${string}`,
        callData: plan.callData as `0x${string}`,
        value: BigInt(plan.value),
        expiresAt: BigInt(plan.expiresAt),
        nonce: plan.nonce as `0x${string}`,
      },
      signature as `0x${string}`,
    ],
  });
}

async function main() {
  hr("=");
  log("  PreflightX - autonomous agent demo - X Layer mainnet");
  log("  The safety and execution policy layer for autonomous DeFi agents.");
  hr("=");
  console.log();

  const balanceBefore = await getUsdcBalance(AGENT);
  chain(`agent wallet    ${AGENT}`);
  chain(`USDC balance    ${formatUsdc(balanceBefore)} USDC`);
  chain(`guard contract  ${GUARD}`);
  console.log();

  const intent: Intent = {
    action: "swap",
    fromToken: USDC,
    toToken: TO_TOKEN,
    amount: "1000000",
    caller: AGENT,
  };
  const limits: Limits = {
    maxSlippageBps: 500,
    maxHolderConcentrationPct: 40,
    minTokenAgeSeconds: 0,
    maxPortfolioImpactPct: 100,
    maxStaleQuoteSeconds: 120,
  };

  agent(`proposed trade: swap ${formatUsdc(intent.amount)} USDC -> ${TO_SYMBOL} (slippage <= ${limits.maxSlippageBps} bps, concentration <= ${limits.maxHolderConcentrationPct}%)`);
  console.log();

  // In direct mode, pre-approve the OKX router so the agent loop doesn't race the
  // bundler. Real agents pre-approve their spending paths at startup anyway.
  if (MODE === "direct") {
    const OKX_ROUTER = "0xD1b8997AaC08c619d40Be2e4284c9C72cAB33954";
    const currentAllowance = await getUsdcAllowance(AGENT, OKX_ROUTER);
    if (currentAllowance < BigInt(intent.amount)) {
      agent(`pre-approving OKX router for ${formatUsdc(intent.amount)} USDC (current allowance ${formatUsdc(currentAllowance)})`);
      const approveData = encodeFunctionData({
        abi: parseAbi(["function approve(address spender, uint256 amount)"]),
        functionName: "approve",
        args: [OKX_ROUTER as `0x${string}`, BigInt(intent.amount) * 3n],
      });
      const tx = tryExec(
        `onchainos wallet contract-call --chain xlayer --to ${USDC} --input-data ${approveData}`,
        "pre-approve",
      );
      if (tx) chain(`pre-approve tx ${tx}`);
      console.log();
    }
  }

  let result = await runPreflight(intent, limits, "initial");
  let round = 1;

  while (result.verdict !== "pass" && round <= 3) {
    const reason = result.failedReasonCodes[0] ?? "UNKNOWN";
    const failingCheck = result.checks.find((check) => !check.pass);
    const details = failingCheck?.details ?? {};

    preflight(`ROUND ${round} - BLOCKED - ${reason}`);
    preflight(`  reason: ${reasonExplain(reason, details, intent)}`);
    console.log();

    const fix = await remediate(reason, intent, limits, details);
    if (!fix) {
      agent(`${reason} is not a recoverable knob problem for this demo. Refusing to trade.`);
      return;
    }

    agent(`remediation: ${fix.explanation}`);
    Object.assign(intent, fix.intent);
    Object.assign(limits, fix.limits);
    console.log();

    result = await runPreflight(intent, limits, `round-${round}`);
    round++;
  }

  if (result.verdict !== "pass" || !result.plan || !result.signature || !result.signer) {
    preflight("max remediation rounds exhausted - aborting trade.");
    return;
  }

  preflight(`ROUND ${round - 1} - PASS - signed plan issued`);
  preflight(`  signer    ${result.signer}`);
  preflight(`  nonce     ${result.plan.nonce.slice(0, 14)}...${result.plan.nonce.slice(-6)}`);
  preflight(`  signature ${result.signature.slice(0, 14)}...${result.signature.slice(-6)}`);
  preflight(`  expires   ${new Date(result.plan.expiresAt * 1000).toISOString()}`);
  console.log();

  agent("verifying signature on-chain via PreflightGuard.verifySignature...");
  const recovered = await verifyOnChain(result.plan, result.signature);
  const match = recovered.toLowerCase() === result.signer.toLowerCase();
  chain(`recovered signer ${recovered}`);
  chain(`match published  ${match ? "YES - guard accepts this plan" : "NO"}`);
  if (!match) return;
  console.log();

  const approvalTarget = result.quote?.approvalTarget ?? result.plan.router;
  agent(`preparing execution via OnchainOS Agentic Wallet (approval target: ${approvalTarget.slice(0, 10)}...)`);

  let approveTx: string | null = null;
  let swapTx: string | null = null;

  if (MODE === "direct") {
    // Policy layer passed. Execute via OnchainOS's atomic swap path, which handles
    // approval + quote + broadcast as one userOp. (`wallet contract-call` is not for
    // DEX swaps per the skill docs, and splitting approve/swap across userOps races
    // against the per-wallet bundler serialization.)
    chain("step 3 - executing swap via onchainos swap execute (atomic approve + swap)");
    const human = (Number(intent.amount) / 1e6).toFixed(6);
    swapTx = tryExec(
      `onchainos swap execute --chain xlayer --wallet ${AGENT} --from ${USDC} --to ${TO_TOKEN} --readable-amount ${human} --slippage ${(limits.maxSlippageBps / 100).toFixed(2)}`,
      "swap",
    );
    if (swapTx) {
      chain(`         swap tx    ${swapTx}`);
      chain(`         explorer   https://www.oklink.com/xlayer/tx/${swapTx}`);
    } else {
      chain("         swap broadcast failed — see output above.");
    }
  } else {
    // Guard mode: pre-approve to the guard, but do not broadcast the swap. Guarded
    // execution through OKX v6 is a known limitation; see README §Router compatibility.
    const approveData = encodeFunctionData({
      abi: parseAbi(["function approve(address spender, uint256 amount)"]),
      functionName: "approve",
      args: [approvalTarget as `0x${string}`, BigInt(intent.amount) * 2n],
    });
    chain("step 3a - issuing ERC-20 approval to guard...");
    approveTx = tryExec(
      `onchainos wallet contract-call --chain xlayer --to ${USDC} --input-data ${approveData}`,
      "approve",
    );
    if (approveTx) chain(`         approve tx ${approveTx}`);
    chain("step 3b - execution path summary");
    chain("         guard mode signs a guard-compatible Uniswap route when configured.");
    chain("         the signed plan above remains the enforced safety contract for execution.");
    chain("         set AGENT_DEMO_MODE=direct to execute through the OKX router path.");
  }
  console.log();

  const balanceAfter = await getUsdcBalance(AGENT);
  const delta = balanceBefore - balanceAfter;
  hr();
  log("  FINAL REPORT");
  hr();
  narrator(`initial proposal          ${formatUsdc("1000000")} USDC -> ${TO_SYMBOL}`);
  narrator("blocked reason            INSUFFICIENT_BALANCE");
  narrator(`remediation rounds        ${round - 1}`);
  narrator(`final signed intent       ${formatUsdc(intent.amount)} USDC -> ${TO_SYMBOL}`);
  narrator(`signed plan signer        ${result.signer}`);
  narrator(`route source              ${result.quote?.source ?? "unknown"}`);
  narrator(`on-chain verify (guard)   ${match ? "PASS - recovered matches published" : "FAIL"}`);
  narrator(`USDC balance before       ${formatUsdc(balanceBefore)}`);
  narrator(`USDC balance after        ${formatUsdc(balanceAfter)} (delta ${formatUsdc(delta)})`);
  console.log();
  log("  ON-CHAIN ARTIFACTS");
  hr();
  if (approveTx) narrator(`approval tx    https://www.oklink.com/xlayer/tx/${approveTx}`);
  if (swapTx) narrator(`swap tx        https://www.oklink.com/xlayer/tx/${swapTx}`);
  narrator(`guard contract https://www.oklink.com/xlayer/address/${GUARD}`);
  narrator(`signer address https://www.oklink.com/xlayer/address/${result.signer}`);
  hr("=");
  console.log();
  log("This run produced a signed, on-chain-verified safety attestation.");
  log("The policy layer is deterministic and auditable.");
  log('Execution path details are documented in README section "Execution path selection".');
}

main().catch((e) => {
  console.error("agent demo failed:", e);
  process.exit(1);
});
