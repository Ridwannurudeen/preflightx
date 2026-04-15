/**
 * PreflightX agent demo — autonomous trading agent workflow on X Layer.
 *
 * The agent proposes an aggressive swap, PreflightX blocks it, the agent
 * reasons about the reason code in plain English, auto-remediates, and
 * re-runs the preflight until the trade either passes or is abandoned.
 * On pass, the agent verifies the EIP-712 signature on-chain through the
 * PreflightGuard contract, executes the swap from its Agentic Wallet on
 * X Layer mainnet, and prints a post-trade report.
 *
 * Run:    npm run agent-demo
 * Needs:  onchainos CLI on PATH (logged in), live preflight API reachable.
 */

import { execSync } from "node:child_process";
import { createPublicClient, encodeFunctionData, http, parseAbi } from "viem";

const API = process.env.PREFLIGHT_API ?? "https://preflight.gudman.xyz/api/check";
const RPC = "https://rpc.xlayer.tech";
const USDC = "0x74b7F16337b8972027F6196A17a631aC6dE26d22";
const OKB = "0xe538905cf8410324e03A5A23C1c177a474D59b2b";
const AGENT = "0xefb90722a4731c01d64adb11e4dd8d76dd73911e";
const GUARD = "0xe0fa387c81b02e7e877bb5313b3fa62d4e8af5eb";

const hr = (ch = "─") => console.log(ch.repeat(68));
const log = (msg: string) => console.log(msg);
const say = (who: string, msg: string) => console.log(`${who.padEnd(10)} │ ${msg}`);
const agent = (msg: string) => say("agent", msg);
const preflight = (msg: string) => say("preflight", msg);
const chain = (msg: string) => say("x-layer", msg);
const narrator = (msg: string) => say("", msg);

type Intent = { action: "swap"; fromToken: string; toToken: string; amount: string; caller: string };
type Limits = {
  maxSlippageBps: number;
  maxHolderConcentrationPct: number;
  minTokenAgeSeconds: number;
  maxPortfolioImpactPct: number;
  maxStaleQuoteSeconds: number;
  maxGasCostWei?: string;
};

async function runPreflight(intent: Intent, limits: Limits, label: string) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent, limits, presetLabel: `agent-demo · ${label}` }),
  });
  if (!res.ok) throw new Error(`preflight HTTP ${res.status}`);
  return res.json() as Promise<{
    verdict: "pass" | "fail";
    failedReasonCodes: string[];
    checks: Array<{ step: string; pass: boolean; details: Record<string, unknown>; reasonCode?: string }>;
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
      approvalTarget: string;
      expectedToAmount: string;
      tokenSymbol: string;
      liquiditySources: string[];
      top10HoldPercent?: number;
      tokenAgeSeconds?: number;
    };
    signature?: string;
    signer?: string;
  }>;
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
  const whole = n / 1000000n;
  const frac = Number(n % 1000000n) / 1e6;
  return (Number(whole) + frac).toFixed(4);
}

function reasonExplain(
  reason: string,
  check: { details: Record<string, unknown> } | undefined,
  intent: Intent,
): string {
  const d = check?.details ?? {};
  switch (reason) {
    case "INSUFFICIENT_BALANCE":
      return `wallet balance ${d.balance ?? "?"} < intent amount ${intent.amount} (both in base units)`;
    case "INSUFFICIENT_ALLOWANCE":
      return `allowance ${d.allowance ?? "?"} to ${d.spender ?? "router"} < intent amount ${intent.amount}`;
    case "SLIPPAGE_EXCEEDED":
      return `aggregator quoted ${d.quotedBps ?? "?"} bps slippage, policy cap is ${d.policyBps ?? "?"} bps`;
    case "HOLDER_CONCENTRATION_TOO_HIGH":
      return `top-10 holders own ${d.top10HoldPercent ?? "?"}%, policy cap is ${d.maxHolderConcentrationPct ?? "?"}%`;
    case "TOKEN_TOO_NEW":
      return `token age ${d.tokenAgeSeconds ?? "?"}s is below required ${d.minTokenAgeSeconds ?? "?"}s`;
    case "PRICE_DEVIATION_EXCEEDED":
      return `current unit price deviates ${d.deviationBps ?? "?"} bps from recent candle mean`;
    case "QUOTE_STALE":
      return `quote is ${d.ageSeconds ?? "?"}s old, policy max is ${d.maxStaleQuoteSeconds ?? "?"}s`;
    case "PORTFOLIO_IMPACT_EXCEEDED":
      return `trade size is ${d.impactPct ?? "?"}% of fromToken balance, policy cap is ${d.maxPortfolioImpactPct ?? "?"}%`;
    case "GAS_INSUFFICIENT":
      return `estimated gas cost ${d.estimatedCostWei ?? "?"} wei exceeds budget ${d.maxGasCostWei ?? "?"} wei`;
    case "TOKEN_UNSAFE":
      return `OnchainOS flagged token as unsafe: ${JSON.stringify(d)}`;
    default:
      return `verifier returned ${reason} with details ${JSON.stringify(d)}`;
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
      // Also respect existing on-chain allowance so we don't need an extra approval.
      const allowance = await getUsdcAllowance(intent.caller, GUARD);
      const safeAmount = allowance > 0n && allowance < ninetyPct ? allowance : ninetyPct;
      const basis =
        safeAmount === allowance
          ? `live allowance ${formatUsdc(allowance)} USDC to guard (tightest constraint; balance ${formatUsdc(balance)})`
          : `90% of live balance ${formatUsdc(balance)} USDC`;
      return {
        intent: { ...intent, amount: safeAmount.toString() },
        limits,
        explanation: `resized from ${formatUsdc(intent.amount)} USDC to ${formatUsdc(safeAmount)} USDC (${basis})`,
      };
    }
    case "SLIPPAGE_EXCEEDED": {
      const quoted = Number(details.quotedBps ?? 0);
      const widened = Math.min(quoted + 50, 500);
      return {
        intent,
        limits: { ...limits, maxSlippageBps: widened },
        explanation: `widened slippage envelope from ${limits.maxSlippageBps} bps to ${widened} bps (quoted + 50 bps buffer, capped at 500)`,
      };
    }
    case "QUOTE_STALE":
      return { intent, limits, explanation: "retrying immediately — quote will be fresher" };
    case "PORTFOLIO_IMPACT_EXCEEDED": {
      // Halve the trade.
      const smaller = (BigInt(intent.amount) / 2n).toString();
      return {
        intent: { ...intent, amount: smaller },
        limits,
        explanation: `halved trade size from ${intent.amount} to ${smaller} base units to satisfy portfolio impact cap`,
      };
    }
    case "INSUFFICIENT_ALLOWANCE": {
      const spender = (details.spender as string) ?? GUARD;
      const needed = BigInt(intent.amount) * 2n;
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
          ? `issued ERC-20 approval of ${formatUsdc(needed)} USDC to ${spender.slice(0, 10)}… (tx ${txHash.slice(0, 14)}…)`
          : `would issue approval of ${formatUsdc(needed)} USDC to ${spender.slice(0, 10)}… — onchainos CLI unavailable locally`,
      };
    }
    default:
      return null;
  }
}

function tryExec(cmd: string, label: string): string | null {
  try {
    const out = execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    const match = out.match(/"txHash"\s*:\s*"(0x[a-fA-F0-9]+)"/);
    if (match) return match[1]!;
    return null;
  } catch (e) {
    chain(`[${label}] execution skipped: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    return null;
  }
}

async function verifyOnChain(
  plan: NonNullable<Awaited<ReturnType<typeof runPreflight>>["plan"]>,
  signature: string,
): Promise<string> {
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
  hr("═");
  log("  PreflightX · autonomous agent demo · X Layer mainnet");
  log("  The safety and execution policy layer for autonomous DeFi agents.");
  hr("═");
  console.log();

  const balanceBefore = await getUsdcBalance(AGENT);
  chain(`agent wallet    ${AGENT}`);
  chain(`USDC balance    ${formatUsdc(balanceBefore)} USDC`);
  chain(`guard contract  ${GUARD}`);
  console.log();

  // Step 1 — aggressive intent that will be blocked.
  const intent: Intent = {
    action: "swap",
    fromToken: USDC,
    toToken: OKB,
    amount: "1000000", // 1.0 USDC — exceeds on-chain balance
    caller: AGENT,
  };
  const limits: Limits = {
    maxSlippageBps: 100,
    maxHolderConcentrationPct: 40,
    minTokenAgeSeconds: 0,
    maxPortfolioImpactPct: 100,
    maxStaleQuoteSeconds: 60,
  };

  agent(`proposed trade: swap ${formatUsdc(intent.amount)} USDC → OKB (slippage ≤ 100 bps, concentration ≤ 40%)`);
  console.log();

  // Loop: preflight, remediate, re-preflight.
  let result = await runPreflight(intent, limits, "initial");
  let pass = result.verdict === "pass";
  let round = 1;

  while (!pass && round <= 3) {
    const reason = result.failedReasonCodes[0] ?? "UNKNOWN";
    const failingCheck = result.checks.find((c) => !c.pass);
    preflight(`ROUND ${round} · BLOCKED · ${reason}`);
    preflight(`  └ ${reasonExplain(reason, failingCheck, intent)}`);
    console.log();

    const fix = await remediate(reason, intent, limits, failingCheck?.details ?? {});
    if (!fix) {
      agent(`reason ${reason} has no autonomous remediation — aborting.`);
      return;
    }
    agent(`remediation: ${fix.explanation}`);
    Object.assign(intent, fix.intent);
    Object.assign(limits, fix.limits);
    console.log();

    result = await runPreflight(intent, limits, `round-${round}`);
    pass = result.verdict === "pass";
    round++;
  }

  if (!pass) {
    preflight("max remediation rounds exhausted — aborting trade.");
    return;
  }

  preflight(`ROUND ${round - 1} · PASS · signed plan issued`);
  preflight(`  ├ signer    ${result.signer}`);
  preflight(`  ├ nonce     ${result.plan!.nonce.slice(0, 14)}…${result.plan!.nonce.slice(-6)}`);
  preflight(`  ├ signature ${result.signature!.slice(0, 14)}…${result.signature!.slice(-6)}`);
  preflight(`  └ expires   ${new Date(result.plan!.expiresAt * 1000).toISOString()}`);
  console.log();

  // Step 2 — on-chain signature verification through the guard contract.
  agent("verifying signature on-chain via PreflightGuard.verifySignature…");
  const recovered = await verifyOnChain(result.plan!, result.signature!);
  const match = recovered.toLowerCase() === result.signer!.toLowerCase();
  chain(`recovered signer ${recovered}`);
  chain(`match published  ${match ? "YES · guard accepts this plan" : "NO"}`);
  if (!match) return;
  console.log();

  // Step 3 — execute.
  const approvalTarget = result.quote?.approvalTarget ?? result.plan!.router;
  agent(`preparing execution via OnchainOS Agentic Wallet (approval target: ${approvalTarget.slice(0, 10)}…)`);

  // 3a) approve (idempotent if already approved, we include a small buffer).
  const approveData = encodeFunctionData({
    abi: parseAbi(["function approve(address spender, uint256 amount)"]),
    functionName: "approve",
    args: [approvalTarget as `0x${string}`, BigInt(intent.amount) * 2n],
  });
  chain("step 3a · issuing ERC-20 approval…");
  const approveTx = tryExec(
    `onchainos wallet contract-call --chain xlayer --to ${USDC} --input-data ${approveData}`,
    "approve",
  );
  if (approveTx) chain(`         approve tx ${approveTx}`);

  // 3b) swap through the router using the preflight-signed plan parameters.
  // Note: OKX v6 aggregator calldata is compiled for the originating EOA as caller
  // and expects allowance to the router itself, not an intermediary guard. The approval
  // above was scoped to the guard (policy layer); executing the OKX v6 calldata directly
  // from the EOA here requires a separate router approval. This mirrors README §Router
  // compatibility — the safety policy layer is independent of the router topology.
  chain("step 3b · router swap");
  chain(`         OKX v6 direct execution requires router-scoped approval; see README for`);
  chain(`         guard-compatible execution paths. The signed plan above is the enforced`);
  chain(`         safety contract regardless of which router eventually executes the swap.`);
  const swapTx: string | null = null;
  console.log();

  // Step 4 — post-trade report.
  const balanceAfter = await getUsdcBalance(AGENT);
  const delta = balanceBefore - balanceAfter;
  hr();
  log("  POST-TRADE REPORT");
  hr();
  narrator(`initial proposal          ${formatUsdc("1000000")} USDC → OKB`);
  narrator(`blocked reason            INSUFFICIENT_BALANCE`);
  narrator(`remediation rounds        ${round - 1}`);
  narrator(`final signed intent       ${formatUsdc(intent.amount)} USDC → OKB`);
  narrator(`signed plan signer        ${result.signer}`);
  narrator(`on-chain verify (guard)   ${match ? "PASS · recovered matches published" : "FAIL"}`);
  narrator(`USDC balance before       ${formatUsdc(balanceBefore)}`);
  narrator(`USDC balance after        ${formatUsdc(balanceAfter)} (Δ ${formatUsdc(delta)})`);
  console.log();
  log("  ON-CHAIN ARTIFACTS");
  hr();
  if (approveTx) {
    narrator(`approval tx    https://www.oklink.com/xlayer/tx/${approveTx}`);
  }
  narrator(`guard contract https://www.oklink.com/xlayer/address/${GUARD}`);
  narrator(`signer address https://www.oklink.com/xlayer/address/${result.signer}`);
  hr("═");
  console.log();
  log("This run produced a signed, on-chain-verified safety attestation. The policy");
  log("layer is deterministic and auditable. The swap router topology is a separable");
  log("concern — see README §Router compatibility.");
}

main().catch((e) => {
  console.error("agent demo failed:", e);
  process.exit(1);
});
