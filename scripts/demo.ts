import { readFileSync } from "node:fs";
import { Preflight } from "../src/index.js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx), l.slice(idx + 1)];
    }),
);

const required = ["ONCHAINOS_API_KEY", "ONCHAINOS_SECRET_KEY", "ONCHAINOS_PASSPHRASE"];
for (const k of required) {
  if (!env[k]) {
    console.error(`Missing ${k} in .env`);
    process.exit(1);
  }
}

const preflight = new Preflight({
  onchainosApiKey: env.ONCHAINOS_API_KEY!,
  onchainosSecretKey: env.ONCHAINOS_SECRET_KEY!,
  onchainosPassphrase: env.ONCHAINOS_PASSPHRASE!,
});

const USDC_X_LAYER = "0x74b7F16337b8972027F6196A17a631aC6dE26d22";
const OKB = "0xe538905cf8410324e03A5A23C1c177a474D59b2b";

const result = await preflight.check(
  {
    action: "swap",
    fromToken: USDC_X_LAYER,
    toToken: OKB,
    amount: "1000000",
    caller: process.env.DEMO_CALLER ?? "0x0000000000000000000000000000000000000000",
  },
  {
    maxSlippageBps: 200,
    maxHolderConcentrationPct: 80,
    minTokenAgeSeconds: 0,
    maxPortfolioImpactPct: 100,
    maxStaleQuoteSeconds: 120,
  },
);

console.log(JSON.stringify(result, null, 2));
