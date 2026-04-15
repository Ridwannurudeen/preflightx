import axios, { type AxiosInstance } from "axios";

export interface UniswapClientOptions {
  baseUrl?: string;
}

export interface UniswapRouteResult {
  source: "uniswap";
  fromAmount: string;
  toAmount: string;
  estimatedSlippageBps: number;
  routerAddress: string;
  callData: string;
  value: string;
  protocolVersion: "v2" | "v3" | "v4";
}

export class UniswapAIClient {
  private readonly http: AxiosInstance;

  constructor(opts: UniswapClientOptions = {}) {
    this.http = axios.create({
      baseURL: opts.baseUrl ?? "https://trade-api.gateway.uniswap.org",
      timeout: 12_000,
    });
  }

  async getRoute(params: {
    chainId: number;
    fromToken: string;
    toToken: string;
    amount: string;
  }): Promise<UniswapRouteResult> {
    const { data } = await this.http.post("/v1/quote", {
      type: "EXACT_INPUT",
      tokenInChainId: params.chainId,
      tokenOutChainId: params.chainId,
      tokenIn: params.fromToken,
      tokenOut: params.toToken,
      amount: params.amount,
      configs: [{ protocols: ["V2", "V3", "V4"], routingType: "CLASSIC" }],
    });
    const q = data?.quote;
    if (!q) throw new Error("Uniswap quote: empty response");
    return {
      source: "uniswap",
      fromAmount: q.input?.amount ?? params.amount,
      toAmount: q.output?.amount ?? "0",
      estimatedSlippageBps: Number(q.slippage ?? 0) * 100,
      routerAddress: q.routerAddress ?? "",
      callData: q.methodParameters?.calldata ?? "0x",
      value: q.methodParameters?.value ?? "0",
      protocolVersion: (q.protocol ?? "v3").toLowerCase() as "v2" | "v3" | "v4",
    };
  }
}
