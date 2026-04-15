import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { createHmac } from "node:crypto";
import { X_LAYER_CHAIN_ID } from "./types";

export interface OnchainosClientOptions {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  baseUrl?: string;
}

function signRequest(
  secretKey: string,
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
): string {
  const preHash = timestamp + method.toUpperCase() + requestPath + body;
  return createHmac("sha256", secretKey).update(preHash).digest("base64");
}

export interface SwapResult {
  fromAmount: string;
  toAmount: string;
  minReceiveAmount: string;
  estimatedSlippageBps: number;
  routerAddress: string;
  callData: string;
  value: string;
  gasLimit: string;
  gasPriceWei: string;
  liquiditySources: string[];
  toTokenSymbol: string;
  toTokenDecimals: number;
  toTokenIsHoneyPot: boolean;
  toTokenTaxRateBps: number;
  toTokenUnitPrice: number;
  fromTokenDecimals: number;
  fromTokenUnitPrice: number;
  contextSlot: number;
  quotedAt: number;
}

export interface CandleRow {
  ts: number;
  open: number;
  close: number;
}

export class OnchainosClient {
  private readonly http: AxiosInstance;

  constructor(opts: OnchainosClientOptions) {
    const baseURL = opts.baseUrl ?? "https://web3.okx.com";
    this.http = axios.create({ baseURL, timeout: 12_000 });
    this.http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      const timestamp = new Date().toISOString();
      const method = (config.method ?? "get").toUpperCase();
      const url = new URL(config.url ?? "", baseURL);
      for (const [k, v] of Object.entries(config.params ?? {})) {
        url.searchParams.set(k, String(v));
      }
      const requestPath = url.pathname + (url.search || "");
      const body = config.data ? JSON.stringify(config.data) : "";
      const sign = signRequest(opts.secretKey, timestamp, method, requestPath, body);
      config.headers.set("OK-ACCESS-KEY", opts.apiKey);
      config.headers.set("OK-ACCESS-SIGN", sign);
      config.headers.set("OK-ACCESS-TIMESTAMP", timestamp);
      config.headers.set("OK-ACCESS-PASSPHRASE", opts.passphrase);
      config.headers.set("Content-Type", "application/json");
      return config;
    });
  }

  async getSwap(params: {
    fromToken: string;
    toToken: string;
    amount: string;
    userWalletAddress: string;
    slippagePercent: number;
  }): Promise<SwapResult> {
    const { data } = await this.http.get("/api/v6/dex/aggregator/swap", {
      params: {
        chainIndex: X_LAYER_CHAIN_ID,
        fromTokenAddress: params.fromToken,
        toTokenAddress: params.toToken,
        amount: params.amount,
        userWalletAddress: params.userWalletAddress,
        slippagePercent: params.slippagePercent,
      },
    });
    const root = data?.data?.[0];
    if (!root?.tx || !root?.routerResult) {
      throw new Error(`OnchainOS v6 swap: empty response (code=${data?.code}, msg=${data?.msg})`);
    }
    const r = root.routerResult;
    const tx = root.tx;
    const toAmt = BigInt(r.toTokenAmount);
    const minRecv = BigInt(tx.minReceiveAmount);
    const slippageBps = toAmt === 0n ? 0 : Number(((toAmt - minRecv) * 10_000n) / toAmt);
    const firstHop = r.dexRouterList?.[0];
    const lastHop = r.dexRouterList?.[r.dexRouterList.length - 1];
    const fromTok = firstHop?.fromToken ?? {};
    const toTok = lastHop?.toToken ?? firstHop?.toToken ?? {};
    const sources = (r.dexRouterList ?? []).map(
      (d: { dexProtocol?: { dexName?: string } }) => d.dexProtocol?.dexName ?? "",
    );

    return {
      fromAmount: r.fromTokenAmount,
      toAmount: r.toTokenAmount,
      minReceiveAmount: tx.minReceiveAmount,
      estimatedSlippageBps: slippageBps,
      routerAddress: tx.to,
      callData: tx.data,
      value: tx.value ?? "0",
      gasLimit: tx.gas ?? "300000",
      gasPriceWei: tx.gasPrice ?? "0",
      liquiditySources: sources,
      toTokenSymbol: toTok.tokenSymbol ?? "",
      toTokenDecimals: Number(toTok.decimal ?? 18),
      toTokenIsHoneyPot: Boolean(toTok.isHoneyPot),
      toTokenTaxRateBps: Math.round(Number(toTok.taxRate ?? 0) * 10_000),
      toTokenUnitPrice: Number(toTok.tokenUnitPrice ?? 0),
      fromTokenDecimals: Number(fromTok.decimal ?? 18),
      fromTokenUnitPrice: Number(fromTok.tokenUnitPrice ?? 0),
      contextSlot: Number(r.contextSlot ?? 0),
      quotedAt: Date.now(),
    };
  }

  async getRecentCandles(
    tokenAddress: string,
    bar: "1m" | "5m" | "15m" | "1H" = "15m",
    limit = 4,
  ): Promise<CandleRow[]> {
    const { data } = await this.http.get("/api/v6/dex/market/candles", {
      params: {
        chainIndex: X_LAYER_CHAIN_ID,
        tokenContractAddress: tokenAddress,
        bar,
        limit,
      },
    });
    const rows = data?.data ?? [];
    return rows
      .map((r: string[] | { ts?: string; o?: string; c?: string }) => {
        if (Array.isArray(r)) {
          return { ts: Number(r[0]), open: Number(r[1]), close: Number(r[4]) };
        }
        return { ts: Number(r.ts), open: Number(r.o), close: Number(r.c) };
      })
      .filter((r: CandleRow) => Number.isFinite(r.close) && r.close > 0);
  }
}
