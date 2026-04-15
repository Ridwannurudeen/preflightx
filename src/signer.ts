import {
  privateKeyToAccount,
  generatePrivateKey,
  type PrivateKeyAccount,
} from "viem/accounts";
import { recoverTypedDataAddress, type Hex } from "viem";
import { EIP712_DOMAIN, EIP712_TYPES, planToEip712, type VerifiedPlan } from "./types.js";

export class PlanSigner {
  private readonly account: PrivateKeyAccount;

  constructor(privateKey: `0x${string}`) {
    this.account = privateKeyToAccount(privateKey);
  }

  get address(): `0x${string}` {
    return this.account.address;
  }

  async sign(plan: VerifiedPlan): Promise<Hex> {
    const message = planToEip712(plan);
    return this.account.signTypedData({
      domain: EIP712_DOMAIN,
      types: EIP712_TYPES,
      primaryType: "VerifiedPlan",
      message,
    });
  }

  static async verify(plan: VerifiedPlan, signature: Hex): Promise<`0x${string}`> {
    const message = planToEip712(plan);
    return recoverTypedDataAddress({
      domain: EIP712_DOMAIN,
      types: EIP712_TYPES,
      primaryType: "VerifiedPlan",
      message,
      signature,
    });
  }
}

export function newSignerKey(): `0x${string}` {
  return generatePrivateKey();
}

export function planNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}
