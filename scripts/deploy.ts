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

const deployerPk = (env.DEPLOYER_PK ?? env.PREFLIGHTX_SIGNER_PK) as `0x${string}` | undefined;
if (!deployerPk) throw new Error("Missing DEPLOYER_PK or PREFLIGHTX_SIGNER_PK in .env");

const deployer = privateKeyToAccount(deployerPk);
const signerAddress = (env.PREFLIGHTX_SIGNER_ADDRESS ?? env.SIGNER_ADDRESS ?? deployer.address) as `0x${string}`;
const artifactPath = path.resolve(import.meta.dirname, "..", "contracts", "out", "PreflightGuard.json");
const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
  abi: unknown[];
  bytecode: `0x${string}`;
};

const wallet = createWalletClient({ account: deployer, chain: xLayer, transport: http(env.RPC_URL) });
const pub = createPublicClient({ chain: xLayer, transport: http(env.RPC_URL) });

const balance = await pub.getBalance({ address: deployer.address });
console.log("Deployer:", deployer.address);
console.log("Signer:  ", signerAddress);
console.log("Balance: ", balance.toString(), "wei");
if (balance === 0n) {
  console.error("Deployer wallet is unfunded. Send a small amount of OKB to:", deployer.address);
  process.exit(1);
}

if (deployer.address.toLowerCase() === signerAddress.toLowerCase()) {
  console.warn("Warning: deployer and attestation signer are the same address. Use a dedicated DEPLOYER_PK for production.");
}

console.log("Deploying PreflightGuard with signer =", signerAddress, "...");

const hash = await wallet.deployContract({
  abi: artifact.abi as never,
  bytecode: artifact.bytecode,
  args: [signerAddress],
});
console.log("Deploy tx:", hash);

const receipt = await pub.waitForTransactionReceipt({ hash });
if (!receipt.contractAddress) {
  console.error("No contract address in receipt");
  process.exit(1);
}
console.log("Deployed PreflightGuard at:", receipt.contractAddress);
console.log("  Block:", receipt.blockNumber);
console.log("  Gas used:", receipt.gasUsed.toString());
console.log("  Explorer:", `https://www.oklink.com/xlayer/address/${receipt.contractAddress}`);
