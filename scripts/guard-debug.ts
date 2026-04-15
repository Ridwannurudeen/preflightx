import { createPublicClient, http, parseAbi } from "viem";
import { xLayer } from "../src/chain.js";

const USDC = "0x74b7F16337b8972027F6196A17a631aC6dE26d22" as const;
const OKB = "0xe538905cf8410324e03A5A23C1c177a474D59b2b" as const;
const CALLER = "0xefb90722a4731c01d64adb11e4dd8d76dd73911e" as const;
const GUARD = process.env.PREFLIGHTGUARD_ADDRESS as `0x${string}` | undefined;

if (!GUARD) {
  throw new Error("Set PREFLIGHTGUARD_ADDRESS before running guard-debug.ts");
}

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
console.log("verdict:", result.verdict, "signer(returned):", result.signer);
if (result.verdict !== "pass") {
  console.error(result);
  process.exit(1);
}

const abi = parseAbi([
  "function verifySignature((address caller, address fromToken, address toToken, uint256 fromAmount, uint256 minToAmount, address router, bytes callData, uint256 value, uint256 expiresAt, bytes32 nonce) plan, bytes signature) view returns (address)",
  "function signer() view returns (address)",
  "function usedNonce(bytes32) view returns (bool)",
]);

const client = createPublicClient({ chain: xLayer, transport: http() });
const onchainSigner = await client.readContract({
  address: GUARD,
  abi,
  functionName: "signer",
});
console.log("guard.signer():", onchainSigner);

const recovered = await client.readContract({
  address: GUARD,
  abi,
  functionName: "verifySignature",
  args: [result.plan, result.signature as `0x${string}`],
});
console.log("verifySignature recovered:", recovered);
console.log("match?:", recovered.toLowerCase() === onchainSigner.toLowerCase());

const nonceUsed = await client.readContract({
  address: GUARD,
  abi,
  functionName: "usedNonce",
  args: [result.plan.nonce as `0x${string}`],
});
console.log("nonce used?:", nonceUsed);
console.log("expires at:", new Date(result.plan.expiresAt * 1000).toISOString(), "(", result.plan.expiresAt, "s )");
console.log("now:", new Date().toISOString());
