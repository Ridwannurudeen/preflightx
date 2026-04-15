import { describe, expect, it, vi, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, parseAbi } from "viem";
import { Preflight } from "../src/verifier.js";
import { OnchainosClient, type SwapResult } from "../src/onchainos.js";
import { UniswapAIClient } from "../src/uniswap.js";
import { PlanSigner } from "../src/signer.js";
import * as chain from "../src/chain.js";

const SIGNER_PK = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const SIGNER_ADDR = privateKeyToAccount(SIGNER_PK).address;

const CALLER = "0xefb90722a4731c01d64adb11e4dd8d76dd73911e" as const;
const FROM_TOKEN = "0x74b7F16337b8972027F6196A17a631aC6dE26d22" as const;
const TO_TOKEN = "0xe538905cf8410324e03A5A23C1c177a474D59b2b" as const;
const ROUTER = "0xD1b8997AaC08c619d40Be2e4284c9C72cAB33954" as const;
const GUARD = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC" as const;

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

function makePreflight(guardContractAddress?: `0x${string}`) {
  return new Preflight({
    onchainosApiKey: "test-key",
    onchainosSecretKey: "test-secret",
    onchainosPassphrase: "test-pass",
    signerPrivateKey: SIGNER_PK,
    ...(guardContractAddress && { guardContractAddress }),
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
    quotedAt: Date.now() - 5_000,
    ...overrides,
  };
}

function stubAllPasses(opts: {
  uniDiverges?: boolean;
  priceDeviation?: boolean;
  top10HoldPercent?: number;
  tokenAgeSeconds?: number;
  priceUpdatedAt?: number;
} = {}) {
  vi.spyOn(OnchainosClient.prototype, "getSwap").mockResolvedValue(stubSwap());
  vi.spyOn(UniswapAIClient.prototype, "getRoute").mockResolvedValue({
    source: "uniswap",
    fromAmount: "1000000",
    toAmount: opts.uniDiverges ? "6000000000000000" : "11750000000000000",
    estimatedSlippageBps: 95,
    routerAddress: ROUTER,
    callData: "0xabcd",
    value: "0",
    protocolVersion: "v3",
  });
  vi.spyOn(chain, "getErc20Balance").mockResolvedValue(BigInt("10000000"));
  vi.spyOn(chain, "getErc20Allowance").mockResolvedValue(BigInt("10000000"));
  vi.spyOn(OnchainosClient.prototype, "getTokenAdvancedInfo").mockResolvedValue({
    riskControlLevel: 1,
    top10HoldPercent: opts.top10HoldPercent ?? 35,
    createTimeMs: Date.now() - (opts.tokenAgeSeconds ?? 86_400) * 1000,
    tokenTags: [],
  });
  vi.spyOn(OnchainosClient.prototype, "getPriceInfo").mockResolvedValue({
    price: 85,
    updatedAt: opts.priceUpdatedAt ?? Date.now() - 5_000,
  });
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
    expect(result.quote).toBeDefined();
    expect(result.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(result.signer).toBe(SIGNER_ADDR);

    const recovered = await PlanSigner.verify(result.plan!, result.signature!);
    expect(recovered.toLowerCase()).toBe(SIGNER_ADDR.toLowerCase());
  });

  it("returns a guard-ready plan that ABI-encodes without reconstruction", async () => {
    stubAllPasses();
    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);
    expect(result.verdict).toBe("pass");

    const guardAbi = parseAbi([
      "function executeWithPreflight((address caller, address fromToken, address toToken, uint256 fromAmount, uint256 minToAmount, address router, bytes callData, uint256 value, uint256 expiresAt, bytes32 nonce) plan, bytes signature) external payable returns (uint256)",
    ]);
    const calldata = encodeFunctionData({
      abi: guardAbi,
      functionName: "executeWithPreflight",
      args: [result.plan!, result.signature!],
    });

    expect(calldata.startsWith("0x")).toBe(true);
    expect(result.plan!.minToAmount).toMatch(/^\d+$/);
  });

  it("verification fails for a tampered plan", async () => {
    stubAllPasses();
    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);
    expect(result.verdict).toBe("pass");

    const tampered = { ...result.plan!, minToAmount: "1" };
    const recovered = await PlanSigner.verify(tampered, result.signature!);
    expect(recovered.toLowerCase()).not.toBe(SIGNER_ADDR.toLowerCase());
  });

  it("short-circuits on insufficient balance and runs no later checks", async () => {
    vi.spyOn(OnchainosClient.prototype, "getSwap").mockResolvedValue(stubSwap());
    vi.spyOn(UniswapAIClient.prototype, "getRoute").mockRejectedValue(new Error("no route"));
    vi.spyOn(chain, "getErc20Balance").mockResolvedValue(BigInt("100"));
    const allowanceSpy = vi.spyOn(chain, "getErc20Allowance");
    const safetySpy = vi.spyOn(OnchainosClient.prototype, "getTokenAdvancedInfo");

    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);

    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["INSUFFICIENT_BALANCE"]);
    expect(allowanceSpy).not.toHaveBeenCalled();
    expect(safetySpy).not.toHaveBeenCalled();
  });

  it("checks allowance against the guard when configured", async () => {
    stubAllPasses();
    const allowanceSpy = vi.spyOn(chain, "getErc20Allowance");

    const preflight = makePreflight(GUARD);
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);

    expect(result.verdict).toBe("pass");
    expect(allowanceSpy).toHaveBeenCalledWith(expect.anything(), FROM_TOKEN, CALLER, GUARD);
    expect(result.quote?.approvalTarget).toBe(GUARD);
  });

  it("fails on malformed route payload", async () => {
    stubAllPasses();
    vi.spyOn(OnchainosClient.prototype, "getSwap").mockResolvedValue(
      stubSwap({ callData: "0x", routerAddress: "0x0000000000000000000000000000000000000000" }),
    );

    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["ROUTE_SIMULATION_FAILED"]);
  });

  it("fails on cross-source divergence", async () => {
    stubAllPasses({ uniDiverges: true });
    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["CROSS_SOURCE_DIVERGENCE"]);
  });

  it("fails on honeypot", async () => {
    stubAllPasses();
    vi.spyOn(OnchainosClient.prototype, "getSwap").mockResolvedValue(
      stubSwap({ toTokenIsHoneyPot: true }),
    );

    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["TOKEN_UNSAFE"]);
  });

  it("fails on holder concentration", async () => {
    stubAllPasses({ top10HoldPercent: 91 });
    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, { ...PASS_LIMITS, maxHolderConcentrationPct: 50 });
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["HOLDER_CONCENTRATION_TOO_HIGH"]);
  });

  it("fails when token age is below policy", async () => {
    stubAllPasses({ tokenAgeSeconds: 300 });
    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, { ...PASS_LIMITS, minTokenAgeSeconds: 3600 });
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["TOKEN_UNSAFE"]);
  });

  it("fails on slippage over limit", async () => {
    stubAllPasses();
    vi.spyOn(OnchainosClient.prototype, "getSwap").mockResolvedValue(
      stubSwap({ estimatedSlippageBps: 500 }),
    );

    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, { ...PASS_LIMITS, maxSlippageBps: 100 });
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["SLIPPAGE_EXCEEDED"]);
  });

  it("fails on stale market data", async () => {
    stubAllPasses({ priceUpdatedAt: Date.now() - 300_000 });
    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, { ...PASS_LIMITS, maxStaleQuoteSeconds: 60 });
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["STALE_QUOTE"]);
  });

  it("fails on price deviation", async () => {
    stubAllPasses({ priceDeviation: true });
    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, PASS_LIMITS);
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["PRICE_DEVIATION_TOO_HIGH"]);
  });

  it("fails when estimated gas cost breaches the caller budget", async () => {
    stubAllPasses();
    const preflight = makePreflight();
    const result = await preflight.check(VALID_INTENT, {
      ...PASS_LIMITS,
      maxGasCostWei: "100000000000000",
    });
    expect(result.verdict).toBe("fail");
    expect(result.failedReasonCodes).toEqual(["GAS_INSUFFICIENT"]);
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

