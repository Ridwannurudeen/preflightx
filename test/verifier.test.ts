import { describe, expect, it, vi, beforeEach } from "vitest";
import { Preflight } from "../src/verifier.js";
import { OnchainosClient, type SwapResult } from "../src/onchainos.js";
import { UniswapAIClient } from "../src/uniswap.js";
import { PlanSigner } from "../src/signer.js";
import * as chain from "../src/chain.js";

const SIGNER_PK = "0xREDACTED_ROTATED_SIGNER_KEY_REMOVED_FROM_HISTORY" as const;
const SIGNER_ADDR = "0xd0C14e287fF6E0B0EC6591BC14FE66CB06FAa0AA" as const;

const CALLER = "0xefb90722a4731c01d64adb11e4dd8d76dd73911e" as const;
const FROM_TOKEN = "0x74b7F16337b8972027F6196A17a631aC6dE26d22" as const;
const TO_TOKEN = "0xe538905cf8410324e03A5A23C1c177a474D59b2b" as const;
const ROUTER = "0xD1b8997AaC08c619d40Be2e4284c9C72cAB33954" as const;

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

function stubSwap(overrides: Partial<SwapResult> = {}): SwapResult {
  return {
    fromAmount: "1000000",
    toAmount: "11700000000000000",
    minReceiveAmount: "11583000000000000",
    estimatedSlippageBps: 100,
    routerAddress: ROUTER,
    callData: "0xabcdef",
    value: "0",
    gasLimit: "300000",
    gasPriceWei: "1000000000",
    liquiditySources: ["OkieStableSwap", "PotatoSwap"],
    toTokenSymbol: "OKB",
    toTokenDecimals: 18,
    toTokenIsHoneyPot: false,
    toTokenTaxRateBps: 0,
    toTokenUnitPrice: 85,
    fromTokenDecimals: 6,
    fromTokenUnitPrice: 1,
    contextSlot: 57_450_603,
    quotedAt: Date.now(),
    ...overrides,
  };
}

function stubAllPasses(opts: { uniDiverges?: boolean; priceDeviation?: boolean } = {}) {
  vi.spyOn(OnchainosClient.prototype, "getSwap").mockResolvedValue(stubSwap());
  vi.spyOn(UniswapAIClient.prototype, "getRoute").mockResolvedValue({
    source: "uniswap",
    fromAmount: "1000000",
    toAmount: opts.uniDiverges ? "6000000000000000" : "11750000000000000",
    estimatedSlippageBps: 95,
    routerAddress: "0xRouter",
    callData: "0xab",
    value: "0",
    protocolVersion: "v3",
  });
  vi.spyOn(chain, "getErc20Balance").mockResolvedValue(BigInt("10000000"));
  vi.spyOn(chain, "getErc20Allowance").mockResolvedValue(BigInt("10000000"));
  const meanClose = opts.priceDeviation ? 50 : 85;
  vi.spyOn(OnchainosClient.prototype, "getRecentCandles").mockResolvedValue([
    { ts: Date.now() - 3 * 900_000, open: meanClose - 1, close: meanClose },
    { ts: Date.now() - 2 * 900_000, open: meanClose, close: meanClose + 0.5 },
    { ts: Date.now() - 900_000, open: meanClose + 0.5, close: meanClose + 0.3 },
    { ts: Date.now(), open: meanClose + 0.3, close: meanClose },
  ]);
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
    vi.spyOn(OnchainosClient.prototype, "getSwap").mockResolvedValue(stubSwap());
    vi.spyOn(UniswapAIClient.prototype, "getRoute").mockRejectedValue(new Error("no route"));
    vi.spyOn(chain, "getErc20Balance").mockResolvedValue(BigInt("100"));
    const allowanceSpy = vi.spyOn(chain, "getErc20Allowance");
    const candlesSpy = vi.spyOn(OnchainosClient.prototype, "getRecentCandles");

    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);

    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["INSUFFICIENT_BALANCE"]);
    expect(result.plan).toBeUndefined();
    expect(result.signature).toBeUndefined();
    expect(allowanceSpy).not.toHaveBeenCalled();
    expect(candlesSpy).not.toHaveBeenCalled();
  });

  it("short-circuits on insufficient allowance", async () => {
    vi.spyOn(OnchainosClient.prototype, "getSwap").mockResolvedValue(stubSwap());
    vi.spyOn(UniswapAIClient.prototype, "getRoute").mockRejectedValue(new Error("no route"));
    vi.spyOn(chain, "getErc20Balance").mockResolvedValue(BigInt("10000000"));
    vi.spyOn(chain, "getErc20Allowance").mockResolvedValue(BigInt("0"));
    const candlesSpy = vi.spyOn(OnchainosClient.prototype, "getRecentCandles");

    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);

    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["INSUFFICIENT_ALLOWANCE"]);
    expect(candlesSpy).not.toHaveBeenCalled();
  });

  it("fails on cross-source divergence", async () => {
    stubAllPasses({ uniDiverges: true });
    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["CROSS_SOURCE_DIVERGENCE"]);
  });

  it("fails on honeypot", async () => {
    vi.spyOn(OnchainosClient.prototype, "getSwap").mockResolvedValue(
      stubSwap({ toTokenIsHoneyPot: true }),
    );
    vi.spyOn(UniswapAIClient.prototype, "getRoute").mockRejectedValue(new Error("no route"));
    vi.spyOn(chain, "getErc20Balance").mockResolvedValue(BigInt("10000000"));
    vi.spyOn(chain, "getErc20Allowance").mockResolvedValue(BigInt("10000000"));

    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["TOKEN_UNSAFE"]);
  });

  it("fails on slippage over limit", async () => {
    vi.spyOn(OnchainosClient.prototype, "getSwap").mockResolvedValue(
      stubSwap({ estimatedSlippageBps: 500 }),
    );
    vi.spyOn(UniswapAIClient.prototype, "getRoute").mockRejectedValue(new Error("no route"));
    vi.spyOn(chain, "getErc20Balance").mockResolvedValue(BigInt("10000000"));
    vi.spyOn(chain, "getErc20Allowance").mockResolvedValue(BigInt("10000000"));

    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, { ...PASS_LIMITS, maxSlippageBps: 100 });
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["SLIPPAGE_EXCEEDED"]);
  });

  it("fails on price deviation", async () => {
    stubAllPasses({ priceDeviation: true });
    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["PRICE_DEVIATION_TOO_HIGH"]);
  });

  it("rejects malformed intents at parse time", async () => {
    const preflight = makePreflight();
    await expect(preflight.check({ action: "swap" })).rejects.toThrow();
  });

  it("nonces are unique across plans", async () => {
    stubAllPasses();
    const preflight = makePreflight();
    const r1 = await preflight.check(VALID_INTENT, PASS_LIMITS);
    const r2 = await preflight.check(VALID_INTENT, PASS_LIMITS);
    expect(r1.plan!.nonce).not.toBe(r2.plan!.nonce);
  });
});
