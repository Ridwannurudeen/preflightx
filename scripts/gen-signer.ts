import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);

console.log("PreflightX attestation key");
console.log("--------------------------");
console.log(`PREFLIGHTX_SIGNER_PK=${pk}`);
console.log(`PREFLIGHTX_SIGNER_ADDRESS=${account.address}`);
console.log();
console.log("Add both to .env. Publish the address with your skill so callers");
console.log("can verify signatures from the public side.");
