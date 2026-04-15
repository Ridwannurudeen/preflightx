import { describe, expect, it } from "vitest";
import { parseAbi, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PlanSigner } from "../src/signer.js";
import { deriveMinToAmount, planToEip712, type VerifiedPlan } from "../src/types.js";

const SIGNER_PK = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const SIGNER_ADDR = privateKeyToAccount(SIGNER_PK).address;

function buildPlan(): VerifiedPlan {
  return {
    caller: "0xefb90722a4731c01d64adb11e4dd8d76dd73911e",
    fromToken: "0x74b7F16337b8972027F6196A17a631aC6dE26d22",
    toToken: "0xe538905cf8410324e03A5A23C1c177a474D59b2b",
    fromAmount: "100000",
    minToAmount: deriveMinToAmount("1170000000000000", 200),
    router: "0xD1b8997AaC08c619d40Be2e4284c9C72cAB33954",
    callData: "0xabcdef",
    value: "0",
    expiresAt: 1900000000,
    nonce: ("0x" + "12".repeat(32)) as `0x${string}`,
  };
}

describe("guard-ready plan helpers", () => {
  it("signs and verifies the exact plan struct expected by the guard", async () => {
    const signer = new PlanSigner(SIGNER_PK);
    const plan = buildPlan();
    const signature = await signer.sign(plan);
    const recovered = await PlanSigner.verify(plan, signature);

    expect(recovered.toLowerCase()).toBe(SIGNER_ADDR.toLowerCase());
  });

  it("converts the guard-ready plan into typed data without hidden slippage inputs", () => {
    const plan = buildPlan();
    const eip712 = planToEip712(plan);

    expect(eip712.minToAmount.toString()).toBe(plan.minToAmount);
    expect(eip712.expiresAt.toString()).toBe(String(plan.expiresAt));
  });

  it("ABI-encodes directly into executeWithPreflight", async () => {
    const signer = new PlanSigner(SIGNER_PK);
    const plan = buildPlan();
    const signature = await signer.sign(plan);
    const guardAbi = parseAbi([
      "function executeWithPreflight((address caller, address fromToken, address toToken, uint256 fromAmount, uint256 minToAmount, address router, bytes callData, uint256 value, uint256 expiresAt, bytes32 nonce) plan, bytes signature) external payable returns (uint256)",
    ]);

    const calldata = encodeFunctionData({
      abi: guardAbi,
      functionName: "executeWithPreflight",
      args: [plan, signature],
    });

    expect(calldata.startsWith("0x")).toBe(true);
    expect(calldata.length).toBeGreaterThan(10);
  });
});
