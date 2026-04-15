import { NextResponse } from "next/server";
import { Preflight } from "@/lib/preflight/verifier";
import { pushEntry } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { intent, limits, presetLabel } = body ?? {};
    if (!intent || !limits) {
      return NextResponse.json({ error: "missing intent or limits" }, { status: 400 });
    }

    const apiKey = process.env.ONCHAINOS_API_KEY;
    const secretKey = process.env.ONCHAINOS_SECRET_KEY;
    const passphrase = process.env.ONCHAINOS_PASSPHRASE;
    const signerPk = process.env.PREFLIGHTX_SIGNER_PK as `0x${string}` | undefined;
    const guardContractAddress = process.env.PREFLIGHTGUARD_ADDRESS as `0x${string}` | undefined;

    if (!apiKey || !secretKey || !passphrase || !signerPk) {
      return NextResponse.json(
        { error: "server missing OnchainOS credentials or signer key" },
        { status: 500 },
      );
    }

    const preflight = new Preflight({
      onchainosApiKey: apiKey,
      onchainosSecretKey: secretKey,
      onchainosPassphrase: passphrase,
      signerPrivateKey: signerPk,
      ...(guardContractAddress && { guardContractAddress }),
    });

    const result = await preflight.check(intent, limits);

    pushEntry({
      verdict: result.verdict,
      fromToken: intent.fromToken,
      toToken: intent.toToken,
      toSymbol: result.quote?.tokenSymbol,
      amount: intent.amount,
      ...(result.failedReasonCodes[0] && { reasonCode: result.failedReasonCodes[0] }),
      ...(result.signer && { signer: result.signer }),
      ...(presetLabel && { presetLabel }),
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
