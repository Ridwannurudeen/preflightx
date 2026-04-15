import { readFileSync } from "node:fs";
import path from "node:path";
import { encodeFunctionData, parseAbi } from "viem";

const envRaw = readFileSync(path.resolve(import.meta.dirname, "..", ".env"), "utf8");
const env = Object.fromEntries(
  envRaw
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx), l.slice(idx + 1)];
    }),
);

const USDC = "0x74b7F16337b8972027F6196A17a631aC6dE26d22" as const;
const OKB = "0xe538905cf8410324e03A5A23C1c177a474D59b2b" as const;
const CALLER = "0xefb90722a4731c01d64adb11e4dd8d76dd73911e" as const;

const res = await fetch("https://preflight.gudman.xyz/api/check", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    intent: {
      action: "swap",
      fromToken: USDC,
      toToken: OKB,
      amount: "100000",
      caller: CALLER,
    },
    limits: {
      maxSlippageBps: 200,
      maxHolderConcentrationPct: 80,
      minTokenAgeSeconds: 0,
      maxPortfolioImpactPct: 100,
      maxStaleQuoteSeconds: 60,
    },
  }),
});
const result = await res.json();
if (result.verdict !== "pass") {
  console.error("preflight did not pass:", result.failedReasonCodes, result);
  process.exit(1);
}

const guardAbi = parseAbi([
  "function executeWithPreflight((address caller, address fromToken, address toToken, uint256 fromAmount, uint256 minToAmount, address router, bytes callData, uint256 value, uint256 expiresAt, bytes32 nonce) plan, bytes signature) external payable returns (uint256)",
]);

const calldata = encodeFunctionData({
  abi: guardAbi,
  functionName: "executeWithPreflight",
  args: [
    result.plan as {
      caller: `0x${string}`;
      fromToken: `0x${string}`;
      toToken: `0x${string}`;
      fromAmount: string;
      minToAmount: string;
      router: `0x${string}`;
      callData: `0x${string}`;
      value: string;
      expiresAt: number;
      nonce: `0x${string}`;
    },
    result.signature as `0x${string}`,
  ],
});

console.log("Guard:", env.PREFLIGHTGUARD_ADDRESS);
console.log("Plan nonce:", result.plan.nonce);
console.log("Caller:", result.plan.caller);
console.log("Approval target:", result.quote?.approvalTarget ?? env.PREFLIGHTGUARD_ADDRESS);
console.log("Calldata length:", calldata.length);
console.log();
console.log("--- Paste this to execute through the guard ---");
console.log(
  `onchainos wallet contract-call --chain xlayer --to ${env.PREFLIGHTGUARD_ADDRESS} --input-data ${calldata} --gas-limit 800000`,
);
