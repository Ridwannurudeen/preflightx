import { describe, expect, it, vi, beforeEach } from "vitest";
import { Preflight } from "../src/verifier.js";
import { OnchainosClient } from "../src/onchainos.js";
import { UniswapAIClient } from "../src/uniswap.js";

const VALID_INTENT = {
  action: "swap" as const,
  fromToken: "0x74b7F16337b8972027F6196A17a631aC6dE26d22",
  toToken: "0xe538905cf8410324e03A5A23C1c177a474D59b2b",
  amount: "1000000",
  caller: "0x917a630f4bd294b68C3ABfD1DD61bff6F6F2d44E",
};

const PASS_LIMITS = {
  maxSlippageBps: 200,
  maxHolderConcentrationPct: 80,
  minTokenAgeSeconds: 0,
  maxPortfolioImpactPct: 100,
  maxStaleQuoteSeconds: 120,
};

function stubOkxQuote(toAmount = "990000000000000000") {
  return {
    fromAmount: "1000000",
    toAmount,
    estimatedSlippageBps: 50,
    routerAddress: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    callData: "0xabcdef",
    value: "0",
    liquiditySources: ["UniswapV3", "OkxDex"],
    quotedAt: Date.now(),
  };
}

function stubTokenInfo(overrides: Partial<{ topHolderConcentrationPct: number; createdAt: number; verified: boolean }> = {}) {
  return {
    address: VALID_INTENT.toToken,
    symbol: "OKB",
    decimals: 18,
    createdAt: Math.floor(Date.now() / 1000) - 365 * 86400,
    verified: true,
    topHolderConcentrationPct: 30,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Preflight.check", () => {
  it("passes when every step succeeds", async () => {
    vi.spyOn(OnchainosClient.prototype, "getQuote").mockResolvedValue(stubOkxQuote());
    vi.spyOn(UniswapAIClient.prototype, "getRoute").mockResolvedValue({
      source: "uniswap",
      fromAmount: "1000000",
      toAmount: "991000000000000000",
      estimatedSlippageBps: 45,
      routerAddress: "0xRouter",
      callData: "0xab",
      value: "0",
      protocolVersion: "v3",
    });
    vi.spyOn(OnchainosClient.prototype, "simulateTx").mockResolvedValue({
      success: true,
      gasUsed: "150000",
    });
    vi.spyOn(OnchainosClient.prototype, "getTokenInfo").mockResolvedValue(stubTokenInfo());
    vi.spyOn(OnchainosClient.prototype, "getMarketPriceUsd").mockResolvedValue({
      price: 50,
      updatedAt: Date.now(),
    });
    vi.spyOn(OnchainosClient.prototype, "getPortfolio").mockResolvedValue({
      totalValueUsd: 100_000,
      balances: [],
    });
    vi.spyOn(OnchainosClient.prototype, "getGasPriceWei").mockResolvedValue("1000000000");

    const preflight = new Preflight({ onchainosApiKey: "test-key", onchainosSecretKey: "test-secret", onchainosPassphrase: "test-pass" });
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);

    expect(result.verdict).toBe("pass");
    expect(result.plan).toBeDefined();
    expect(result.signature).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.failedReasonCodes).toEqual([]);
  });

  it("fails on slippage when over limit", async () => {
    vi.spyOn(OnchainosClient.prototype, "getQuote").mockResolvedValue(
      stubOkxQuote("990000000000000000"),
    );
    const okxQuote = stubOkxQuote();
    okxQuote.estimatedSlippageBps = 500;
    vi.spyOn(OnchainosClient.prototype, "getQuote").mockResolvedValue(okxQuote);
    vi.spyOn(UniswapAIClient.prototype, "getRoute").mockRejectedValue(new Error("no route"));
    vi.spyOn(OnchainosClient.prototype, "simulateTx").mockResolvedValue({
      success: true,
      gasUsed: "150000",
    });
    vi.spyOn(OnchainosClient.prototype, "getTokenInfo").mockResolvedValue(stubTokenInfo());
    vi.spyOn(OnchainosClient.prototype, "getMarketPriceUsd").mockResolvedValue({
      price: 50,
      updatedAt: Date.now(),
    });
    vi.spyOn(OnchainosClient.prototype, "getPortfolio").mockResolvedValue({
      totalValueUsd: 100_000,
      balances: [],
    });
    vi.spyOn(OnchainosClient.prototype, "getGasPriceWei").mockResolvedValue("1000000000");

    const preflight = new Preflight({ onchainosApiKey: "test-key", onchainosSecretKey: "test-secret", onchainosPassphrase: "test-pass" });
    const result = await preflight.check(VALID_INTENT, { ...PASS_LIMITS, maxSlippageBps: 100 });

    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toContain("SLIPPAGE_EXCEEDED");
    expect(result.plan).toBeUndefined();
  });

  it("fails on holder concentration when over limit", async () => {
    vi.spyOn(OnchainosClient.prototype, "getQuote").mockResolvedValue(stubOkxQuote());
    vi.spyOn(UniswapAIClient.prototype, "getRoute").mockRejectedValue(new Error("no route"));
    vi.spyOn(OnchainosClient.prototype, "simulateTx").mockResolvedValue({
      success: true,
      gasUsed: "150000",
    });
    vi.spyOn(OnchainosClient.prototype, "getTokenInfo").mockResolvedValue(
      stubTokenInfo({ topHolderConcentrationPct: 95 }),
    );
    vi.spyOn(OnchainosClient.prototype, "getMarketPriceUsd").mockResolvedValue({
      price: 50,
      updatedAt: Date.now(),
    });
    vi.spyOn(OnchainosClient.prototype, "getPortfolio").mockResolvedValue({
      totalValueUsd: 100_000,
      balances: [],
    });
    vi.spyOn(OnchainosClient.prototype, "getGasPriceWei").mockResolvedValue("1000000000");

    const preflight = new Preflight({ onchainosApiKey: "test-key", onchainosSecretKey: "test-secret", onchainosPassphrase: "test-pass" });
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);

    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toContain("HOLDER_CONCENTRATION_TOO_HIGH");
  });

  it("rejects malformed intents at parse time", async () => {
    const preflight = new Preflight({ onchainosApiKey: "test-key", onchainosSecretKey: "test-secret", onchainosPassphrase: "test-pass" });
    await expect(preflight.check({ action: "swap" })).rejects.toThrow();
  });
});
