import { createPublicClient, http, erc20Abi, type PublicClient } from "viem";
import { defineChain } from "viem/utils";

export const xLayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.xlayer.tech"] },
  },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.oklink.com/xlayer" },
  },
});

export function createChainClient(rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: xLayer,
    transport: http(rpcUrl ?? "https://rpc.xlayer.tech"),
  });
}

export async function getErc20Balance(
  client: PublicClient,
  token: `0x${string}`,
  owner: `0x${string}`,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

export async function getErc20Allowance(
  client: PublicClient,
  token: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
}
