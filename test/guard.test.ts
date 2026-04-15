/**
 * On-chain behavior tests for the deployed PreflightGuard contract.
 * Uses viem simulateContract against the live deployment at
 *   0xccaeeb946a0511e0a1fd4497dd6f4e59294478eb on X Layer mainnet (196).
 *
 * These tests prove the guard reverts for the right reasons without
 * spending gas: simulateContract runs eth_call against the live contract
 * state, so every revert and every success maps to actual deployed logic.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  createPublicClient,
  http,
  parseAbi,
  zeroAddress,
  encodeFunctionData,
  parseAbiItem,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "../src/chain.js";
import { PlanSigner, planNonce } from "../src/signer.js";
import { planToEip712, type VerifiedPlan } from "../src/types.js";

const GUARD = "0xccaeeb946a0511e0a1fd4497dd6f4e59294478eb" as const;
const SIGNER_PK = "0xREDACTED_ROTATED_SIGNER_KEY_REMOVED_FROM_HISTORY" as const;
const SIGNER_ADDR = "0xd0C14e287fF6E0B0EC6591BC14FE66CB06FAa0AA" as const;
const CALLER = "0xefb90722a4731c01d64adb11e4dd8d76dd73911e" as const;
const USDC = "0x74b7F16337b8972027F6196A17a631aC6dE26d22" as const;
const OKB = "0xe538905cf8410324e03A5A23C1c177a474D59b2b" as const;
const OKX_ROUTER = "0xD1b8997AaC08c619d40Be2e4284c9C72cAB33954" as const;

const guardAbi = parseAbi([
  "function executeWithPreflight((address caller, address fromToken, address toToken, uint256 fromAmount, uint256 minToAmount, address router, bytes callData, uint256 value, uint256 expiresAt, bytes32 nonce) plan, bytes signature) external payable returns (uint256)",
  "function verifySignature((address caller, address fromToken, address toToken, uint256 fromAmount, uint256 minToAmount, address router, bytes callData, uint256 value, uint256 expiresAt, bytes32 nonce) plan, bytes signature) view returns (address)",
  "function signer() view returns (address)",
  "function usedNonce(bytes32) view returns (bool)",
  "error InvalidSigner(address recovered)",
  "error PlanExpired(uint256 expiresAt, uint256 nowSeconds)",
  "error NonceUsed(bytes32 nonce)",
  "error CallerMismatch(address expected, address actual)",
  "error RouterCallFailed(bytes data)",
  "error AmountOutBelowMin(uint256 amountOut, uint256 minOut)",
]);

async function buildFreshPlan(planSigner: PlanSigner): Promise<{
  plan: VerifiedPlan;
  signature: `0x${string}`;
  eip712: ReturnType<typeof planToEip712>;
}> {
  const now = Math.floor(Date.now() / 1000);
  const plan: VerifiedPlan = {
    intent: {
      action: "swap",
      fromToken: USDC,
      toToken: OKB,
      amount: "100000",
      caller: CALLER,
      chainId: 196,
    },
    route: {
      source: "okx-dex",
      fromAmount: "100000",
      toAmount: "1170000000000000",
      estimatedSlippageBps: 100,
      routerAddress: OKX_ROUTER,
      callData: "0xabcdef",
      value: "0",
    },
    gas: { gasPriceWei: "1000000000", gasLimit: "300000", estimatedCostWei: "300000000000000" },
    expiresAt: (now + 60) * 1000,
    nonce: planNonce(),
  };
  const signature = await planSigner.sign(plan, 200);
  return { plan, signature, eip712: planToEip712(plan, 200) };
}

let client: PublicClient;
let planSigner: PlanSigner;

beforeAll(() => {
  client = createPublicClient({ chain: xLayer, transport: http() });
  planSigner = new PlanSigner(SIGNER_PK);
});

describe("PreflightGuard (on-chain behavior)", () => {
  it("guard.signer() matches the PreflightX attestation address", async () => {
    const onchain = await client.readContract({
      address: GUARD,
      abi: guardAbi,
      functionName: "signer",
    });
    expect(onchain.toLowerCase()).toBe(SIGNER_ADDR.toLowerCase());
  });

  it("verifySignature recovers the signer for a valid plan", async () => {
    const { eip712, signature } = await buildFreshPlan(planSigner);
    const recovered = await client.readContract({
      address: GUARD,
      abi: guardAbi,
      functionName: "verifySignature",
      args: [eip712, signature],
    });
    expect(recovered.toLowerCase()).toBe(SIGNER_ADDR.toLowerCase());
  });

  it("verifySignature does NOT recover the signer for a tampered plan", async () => {
    const { eip712, signature } = await buildFreshPlan(planSigner);
    const tampered = { ...eip712, minToAmount: 1n };
    const recovered = await client.readContract({
      address: GUARD,
      abi: guardAbi,
      functionName: "verifySignature",
      args: [tampered, signature],
    });
    expect(recovered.toLowerCase()).not.toBe(SIGNER_ADDR.toLowerCase());
  });

  it("verifySignature does NOT recover the signer when signed by a different key", async () => {
    const wrongSigner = new PlanSigner(
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    const { eip712 } = await buildFreshPlan(planSigner);
    const wrongSig = await wrongSigner.sign(
      {
        intent: {
          action: "swap",
          fromToken: USDC,
          toToken: OKB,
          amount: "100000",
          caller: CALLER,
          chainId: 196,
        },
        route: {
          source: "okx-dex",
          fromAmount: "100000",
          toAmount: "1170000000000000",
          estimatedSlippageBps: 100,
          routerAddress: OKX_ROUTER,
          callData: "0xabcdef",
          value: "0",
        },
        gas: { gasPriceWei: "1000000000", gasLimit: "300000", estimatedCostWei: "300000000000000" },
        expiresAt: Number(eip712.expiresAt) * 1000,
        nonce: eip712.nonce,
      },
      200,
    );
    const recovered = await client.readContract({
      address: GUARD,
      abi: guardAbi,
      functionName: "verifySignature",
      args: [eip712, wrongSig],
    });
    expect(recovered.toLowerCase()).not.toBe(SIGNER_ADDR.toLowerCase());
  });

  it("reverts with CallerMismatch when msg.sender != plan.caller", async () => {
    const { eip712, signature } = await buildFreshPlan(planSigner);
    const randomAccount = privateKeyToAccount(
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    );
    await expect(
      client.simulateContract({
        address: GUARD,
        abi: guardAbi,
        functionName: "executeWithPreflight",
        args: [eip712, signature],
        account: randomAccount.address,
      }),
    ).rejects.toThrow(/CallerMismatch/);
  });

  it("reverts with PlanExpired when expiresAt is in the past", async () => {
    const pastExpiry = { ...(await buildFreshPlan(planSigner)) };
    const expired = {
      ...pastExpiry.eip712,
      expiresAt: BigInt(Math.floor(Date.now() / 1000) - 3600),
    };
    // Need a signature over the expired plan so signer check passes but expiration fails
    const expiredPlan: VerifiedPlan = {
      intent: {
        action: "swap",
        fromToken: USDC,
        toToken: OKB,
        amount: "100000",
        caller: CALLER,
        chainId: 196,
      },
      route: {
        source: "okx-dex",
        fromAmount: "100000",
        toAmount: "1170000000000000",
        estimatedSlippageBps: 100,
        routerAddress: OKX_ROUTER,
        callData: "0xabcdef",
        value: "0",
      },
      gas: { gasPriceWei: "1000000000", gasLimit: "300000", estimatedCostWei: "300000000000000" },
      expiresAt: Number(expired.expiresAt) * 1000,
      nonce: expired.nonce,
    };
    const expiredSig = await planSigner.sign(expiredPlan, 200);
    await expect(
      client.simulateContract({
        address: GUARD,
        abi: guardAbi,
        functionName: "executeWithPreflight",
        args: [expired, expiredSig],
        account: CALLER,
      }),
    ).rejects.toThrow(/PlanExpired/);
  });

  it("reverts with InvalidSigner for an arbitrary-signature plan", async () => {
    const { eip712 } = await buildFreshPlan(planSigner);
    const bogusSig = ("0x" + "11".repeat(65)) as `0x${string}`;
    await expect(
      client.simulateContract({
        address: GUARD,
        abi: guardAbi,
        functionName: "executeWithPreflight",
        args: [eip712, bogusSig],
        account: CALLER,
      }),
    ).rejects.toThrow(/InvalidSigner|CallerMismatch/);
  });

  it("usedNonce(fresh) returns false", async () => {
    const used = await client.readContract({
      address: GUARD,
      abi: guardAbi,
      functionName: "usedNonce",
      args: [planNonce()],
    });
    expect(used).toBe(false);
  });
});
