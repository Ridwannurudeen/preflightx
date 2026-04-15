import { readFileSync } from "node:fs";
import path from "node:path";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "../src/chain.js";

const env = Object.fromEntries(
  readFileSync(path.resolve(import.meta.dirname, "..", ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx), l.slice(idx + 1)];
    }),
);

const pk = env.PREFLIGHTX_SIGNER_PK as `0x${string}`;
if (!pk) throw new Error("Missing PREFLIGHTX_SIGNER_PK in .env");

const account = privateKeyToAccount(pk);
const artifactPath = path.resolve(import.meta.dirname, "..", "contracts", "out", "PreflightGuard.json");
const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
  abi: unknown[];
  bytecode: `0x${string}`;
};

const wallet = createWalletClient({ account, chain: xLayer, transport: http(env.RPC_URL) });
const pub = createPublicClient({ chain: xLayer, transport: http(env.RPC_URL) });

const balance = await pub.getBalance({ address: account.address });
console.log("Deployer:", account.address);
console.log("Balance: ", balance.toString(), "wei");
if (balance === 0n) {
  console.error("Deployer wallet is unfunded. Send a small amount of OKB to:", account.address);
  process.exit(1);
}

console.log("Deploying PreflightGuard with signer =", account.address, "...");

const hash = await wallet.deployContract({
  abi: artifact.abi as never,
  bytecode: artifact.bytecode,
  args: [account.address],
});
console.log("Deploy tx:", hash);

const receipt = await pub.waitForTransactionReceipt({ hash });
if (!receipt.contractAddress) {
  console.error("No contract address in receipt");
  process.exit(1);
}
console.log("✓ PreflightGuard deployed at:", receipt.contractAddress);
console.log("  Block:", receipt.blockNumber);
console.log("  Gas used:", receipt.gasUsed.toString());
console.log("  Explorer:", `https://www.oklink.com/xlayer/address/${receipt.contractAddress}`);
