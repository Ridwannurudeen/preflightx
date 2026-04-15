import { describe, expect, it, vi, beforeEach } from "vitest";
import { Preflight } from "../src/verifier.js";
import { OnchainosClient } from "../src/onchainos.js";
import { UniswapAIClient } from "../src/uniswap.js";
import { PlanSigner } from "../src/signer.js";
import * as chain from "../src/chain.js";

const SIGNER_PK = "0xREDACTED_ROTATED_SIGNER_KEY_REMOVED_FROM_HISTORY" as const;
const SIGNER_ADDR = "0xd0C14e287fF6E0B0EC6591BC14FE66CB06FAa0AA" as const;

const CALLER = "0x917a630f4bd294b68C3ABfD1DD61bff6F6F2d44E" as const;
const FROM_TOKEN = "0x74b7F16337b8972027F6196A17a631aC6dE26d22" as const;
const TO_TOKEN = "0xe538905cf8410324e03A5A23C1c177a474D59b2b" as const;
const ROUTER = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

const VALID_INTENT = {
  action: "swap" as const,
  fromToken: FROM_TOKEN,
  toToken: TO_TOKEN,
  amount: "1000000",
  caller: CALLER,
};

const PASS_LIMITS = {
  maxSlippageBps: 200,
  maxHolderConcentrationPct: 80,
  minTokenAgeSeconds: 0,
  maxPortfolioImpactPct: 100,
  maxStaleQuoteSeconds: 120,
};

function makePreflight() {
  return new Preflight({
    onchainosApiKey: "test-key",
    onchainosSecretKey: "test-secret",
    onchainosPassphrase: "test-pass",
    signerPrivateKey: SIGNER_PK,
  });
}

function stubOkxQuote(toAmount = "990000000000000000", slippageBps = 50) {
  return {
    fromAmount: "1000000",
    toAmount,
    estimatedSlippageBps: slippageBps,
    routerAddress: ROUTER,
    callData: "0xabcdef",
    value: "0",
    liquiditySources: ["UniswapV3", "OkxDex"],
    quotedAt: Date.now(),
  };
}

function stubTokenInfo(
  overrides: Partial<{
    topHolderConcentrationPct: number;
    createdAt: number;
    verified: boolean;
  }> = {},
) {
  return {
    address: TO_TOKEN,
    symbol: "OKB",
    decimals: 18,
    createdAt: Math.floor(Date.now() / 1000) - 365 * 86400,
    verified: true,
    topHolderConcentrationPct: 30,
    ...overrides,
  };
}

function stubAllPasses(opts: { uniDiverges?: boolean } = {}) {
  vi.spyOn(OnchainosClient.prototype, "getQuote").mockResolvedValue(stubOkxQuote());
  vi.spyOn(UniswapAIClient.prototype, "getRoute").mockResolvedValue({
    source: "uniswap",
    fromAmount: "1000000",
    toAmount: opts.uniDiverges ? "500000000000000000" : "991000000000000000",
    estimatedSlippageBps: 45,
    routerAddress: "0xRouter",
    callData: "0xab",
    value: "0",
    protocolVersion: "v3",
  });
  vi.spyOn(chain, "getErc20Balance").mockResolvedValue(BigInt("10000000"));
  vi.spyOn(chain, "getErc20Allowance").mockResolvedValue(BigInt("10000000"));
  vi.spyOn(OnchainosClient.prototype, "simulateTx").mockResolvedValue({
    success: true,
    gasUsed: "150000",
  });
  vi.spyOn(OnchainosClient.prototype, "getTokenInfo").mockResolvedValue(stubTokenInfo());
  vi.spyOn(OnchainosClient.prototype, "getMarketPriceUsd").mockResolvedValue({
    price: 50,
    updatedAt: Date.now(),
  });
  vi.spyOn(OnchainosClient.prototype, "getRecentCandles").mockResolvedValue([
    { ts: Date.now() - 3 * 900_000, open: 49.5, close: 50.0 },
    { ts: Date.now() - 2 * 900_000, open: 50.0, close: 50.2 },
    { ts: Date.now() - 1 * 900_000, open: 50.2, close: 50.1 },
    { ts: Date.now(), open: 50.1, close: 50.0 },
  ]);
  vi.spyOn(OnchainosClient.prototype, "getPortfolio").mockResolvedValue({
    totalValueUsd: 100_000,
    balances: [],
  });
  vi.spyOn(OnchainosClient.prototype, "getGasPriceWei").mockResolvedValue("1000000000");
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Preflight.check", () => {
  it("passes and returns a real EIP-712 signature recoverable to the signer", async () => {
    stubAllPasses();
    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);

    expect(result.verdict).toBe("pass");
    expect(result.plan).toBeDefined();
    expect(result.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(result.signer).toBe(SIGNER_ADDR);

    const recovered = await PlanSigner.verify(
      result.plan!,
      PASS_LIMITS.maxSlippageBps,
      result.signature!,
    );
    expect(recovered.toLowerCase()).toBe(SIGNER_ADDR.toLowerCase());
  });

  it("verification fails for a tampered plan", async () => {
    stubAllPasses();
    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);
    expect(result.verdict).toBe("pass");

    const tampered = {
      ...result.plan!,
      route: { ...result.plan!.route, toAmount: "1" },
    };
    const recovered = await PlanSigner.verify(
      tampered,
      PASS_LIMITS.maxSlippageBps,
      result.signature!,
    );
    expect(recovered.toLowerCase()).not.toBe(SIGNER_ADDR.toLowerCase());
  });

  it("short-circuits on insufficient balance and runs no later checks", async () => {
    vi.spyOn(OnchainosClient.prototype, "getQuote").mockResolvedValue(stubOkxQuote());
    vi.spyOn(UniswapAIClient.prototype, "getRoute").mockRejectedValue(new Error("no route"));
    vi.spyOn(chain, "getErc20Balance").mockResolvedValue(BigInt("100"));
    const allowanceSpy = vi.spyOn(chain, "getErc20Allowance");
    const simSpy = vi.spyOn(OnchainosClient.prototype, "simulateTx");

    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);

    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["INSUFFICIENT_BALANCE"]);
    expect(result.plan).toBeUndefined();
    expect(result.signature).toBeUndefined();
    expect(allowanceSpy).not.toHaveBeenCalled();
    expect(simSpy).not.toHaveBeenCalled();
  });

  it("short-circuits on insufficient allowance", async () => {
    vi.spyOn(OnchainosClient.prototype, "getQuote").mockResolvedValue(stubOkxQuote());
    vi.spyOn(UniswapAIClient.prototype, "getRoute").mockRejectedValue(new Error("no route"));
    vi.spyOn(chain, "getErc20Balance").mockResolvedValue(BigInt("10000000"));
    vi.spyOn(chain, "getErc20Allowance").mockResolvedValue(BigInt("0"));
    const simSpy = vi.spyOn(OnchainosClient.prototype, "simulateTx");

    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);

    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["INSUFFICIENT_ALLOWANCE"]);
    expect(simSpy).not.toHaveBeenCalled();
  });

  it("fails on cross-source divergence", async () => {
    stubAllPasses({ uniDiverges: true });
    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["CROSS_SOURCE_DIVERGENCE"]);
  });

  it("fails on holder concentration", async () => {
    vi.spyOn(OnchainosClient.prototype, "getQuote").mockResolvedValue(stubOkxQuote());
    vi.spyOn(UniswapAIClient.prototype, "getRoute").mockRejectedValue(new Error("no route"));
    vi.spyOn(chain, "getErc20Balance").mockResolvedValue(BigInt("10000000"));
    vi.spyOn(chain, "getErc20Allowance").mockResolvedValue(BigInt("10000000"));
    vi.spyOn(OnchainosClient.prototype, "simulateTx").mockResolvedValue({
      success: true,
      gasUsed: "150000",
    });
    vi.spyOn(OnchainosClient.prototype, "getTokenInfo").mockResolvedValue(
      stubTokenInfo({ topHolderConcentrationPct: 95 }),
    );

    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);

    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["HOLDER_CONCENTRATION_TOO_HIGH"]);
  });

  it("rejects malformed intents at parse time", async () => {
    const preflight = makePreflight();
    await expect(preflight.check({ action: "swap" })).rejects.toThrow();
  });

  it("fails on price deviation beyond 1000 bps from candle mean", async () => {
    stubAllPasses();
    vi.spyOn(OnchainosClient.prototype, "getMarketPriceUsd").mockResolvedValue({
      price: 80, // 60% above mean candle close of 50
      updatedAt: Date.now(),
    });
    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["PRICE_DEVIATION_TOO_HIGH"]);
  });

  it("nonces are unique across plans", async () => {
    stubAllPasses();
    const preflight = makePreflight();
    const r1 = await preflight.check(VALID_INTENT, PASS_LIMITS);
    const r2 = await preflight.check(VALID_INTENT, PASS_LIMITS);
    expect(r1.plan!.nonce).not.toBe(r2.plan!.nonce);
  });
});
