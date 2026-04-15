import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import solc from "solc";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "contracts", "PreflightGuard.sol");
const OUT = path.join(ROOT, "contracts", "out");

mkdirSync(OUT, { recursive: true });

const source = readFileSync(SRC, "utf8");

const input = {
  language: "Solidity",
  sources: { "PreflightGuard.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "shanghai",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  const fatal = output.errors.filter((e: { severity: string }) => e.severity === "error");
  for (const e of output.errors) console.log(e.formattedMessage);
  if (fatal.length > 0) process.exit(1);
}

const contract = output.contracts["PreflightGuard.sol"]["PreflightGuard"];
const artifact = {
  abi: contract.abi,
  bytecode: "0x" + contract.evm.bytecode.object,
  deployedBytecode: "0x" + contract.evm.deployedBytecode.object,
};

writeFileSync(path.join(OUT, "PreflightGuard.json"), JSON.stringify(artifact, null, 2));
console.log("Compiled PreflightGuard.sol");
console.log("Bytecode size:", artifact.bytecode.length / 2 - 1, "bytes");
console.log("Output:", path.relative(ROOT, path.join(OUT, "PreflightGuard.json")));
