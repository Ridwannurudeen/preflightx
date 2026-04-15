import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem } from "viem";
import { defineChain } from "viem/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 30;

const xLayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.oklink.com/xlayer" },
  },
});

const GUARD = (process.env.PREFLIGHTGUARD_ADDRESS ||
  "0xccaeeb946a0511e0a1fd4497dd6f4e59294478eb") as `0x${string}`;

const EXECUTED_EVENT = parseAbiItem(
  "event PreflightExecuted(address indexed caller, address indexed router, bytes32 indexed nonce, address fromToken, address toToken, uint256 fromAmount, uint256 minToAmount, uint256 amountOut)",
);

export async function GET() {
  try {
    const client = createPublicClient({ chain: xLayer, transport: http() });
    const current = await client.getBlockNumber();
    const fromBlock = current > 50_000n ? current - 50_000n : 0n;

    const logs = await client.getLogs({
      address: GUARD,
      event: EXECUTED_EVENT,
      fromBlock,
      toBlock: current,
    });

    const events = logs.slice(-20).reverse().map((l) => ({
      txHash: l.transactionHash,
      blockNumber: Number(l.blockNumber),
      caller: l.args.caller,
      router: l.args.router,
      nonce: l.args.nonce,
      fromToken: l.args.fromToken,
      toToken: l.args.toToken,
      fromAmount: l.args.fromAmount?.toString(),
      minToAmount: l.args.minToAmount?.toString(),
      amountOut: l.args.amountOut?.toString(),
    }));

    return NextResponse.json({
      guard: GUARD,
      currentBlock: current.toString(),
      scannedFrom: fromBlock.toString(),
      count: events.length,
      events,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { guard: GUARD, error: message, count: 0, events: [] },
      { status: 200 },
    );
  }
}
