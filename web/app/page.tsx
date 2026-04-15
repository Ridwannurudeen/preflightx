"use client";

import { useEffect, useState } from "react";
import { PRESETS, POLICY_PROFILES, type Preset, type PolicyProfile } from "@/lib/presets";

type CheckResult = {
  verdict: "pass" | "fail";
  checks: Array<{ step: string; pass: boolean; details: Record<string, unknown>; reasonCode?: string }>;
  failedReasonCodes: string[];
  plan?: {
    caller: string;
    fromToken: string;
    toToken: string;
    fromAmount: string;
    minToAmount: string;
    router: string;
    callData: string;
    value: string;
    expiresAt: number;
    nonce: string;
  };
  quote?: {
    source: string;
    expectedToAmount: string;
    estimatedSlippageBps: number;
    liquiditySources: string[];
    approvalTarget: string;
    gasPriceWei: string;
    gasLimit: string;
    estimatedCostWei: string;
    quotedAt: number;
    priceUpdatedAt?: number;
    tokenSymbol: string;
    tokenTags: string[];
    riskControlLevel?: number;
    top10HoldPercent?: number;
    tokenAgeSeconds?: number;
  };
  signature?: string;
  signer?: string;
  verifiedAt: number;
  error?: string;
};

type FeedEntry = {
  id: string;
  timestamp: number;
  verdict: "pass" | "fail";
  fromToken: string;
  toToken: string;
  toSymbol?: string;
  amount: string;
  reasonCode?: string;
  presetLabel?: string;
};

const GUARD = process.env.NEXT_PUBLIC_PREFLIGHTGUARD_ADDRESS ?? "";
const SIGNER = process.env.NEXT_PUBLIC_PREFLIGHTX_SIGNER_ADDRESS ?? "";

const truncate = (s: string, head = 10, tail = 6) => (!s || s.length <= head + tail + 2 ? s : `${s.slice(0, head)}...${s.slice(-tail)}`);
const ago = (ms: number) => {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
};
const formatSeconds = (seconds?: number) => seconds === undefined ? "n/a" : seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`;

export default function Home() {
  const [selected, setSelected] = useState<Preset>(PRESETS[0]);
  const [profile, setProfile] = useState<PolicyProfile | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [feed, setFeed] = useState<FeedEntry[]>([]);

  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch("/api/feed", { cache: "no-store" });
        const data = await r.json();
        setFeed(data.entries ?? []);
      } catch {}
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  const run = async (preset: Preset) => {
    setSelected(preset);
    setResult(null);
    setLoading(true);
    const limits = profile ? profile.limits : preset.limits;
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: preset.intent, limits, presetLabel: profile ? `${preset.label} / ${profile.name}` : preset.label }),
      });
      setResult((await res.json()) as CheckResult);
    } catch (e) {
      setResult({ verdict: "fail", checks: [], failedReasonCodes: [], verifiedAt: Date.now(), error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="max-w-6xl mx-auto px-6 py-16">
      <header className="mb-16">
        <div className="text-xs uppercase tracking-widest text-mute mb-4">OKX Build X / Skill Arena</div>
        <h1 className="text-5xl font-bold mb-6 leading-tight">Preflight before you trade.<br /><span className="text-mute">Sign the exact plan the guard executes.</span></h1>
        <p className="text-lg text-gray-400 max-w-2xl leading-relaxed">PreflightX verifies a live X Layer swap, checks balance, allowance, concentration, token age, slippage, price deviation, gas, and market-data freshness, then signs the exact `executeWithPreflight` struct.</p>
        <div className="mt-8 flex flex-wrap gap-3 text-xs">
          <a href="https://github.com/Ridwannurudeen/preflightx" className="px-3 py-1.5 bg-card border border-border rounded-full hover:border-ok transition">GitHub -&gt;</a>
          {GUARD ? <a href={`https://www.oklink.com/xlayer/address/${GUARD}`} className="px-3 py-1.5 bg-card border border-border rounded-full hover:border-ok transition font-mono">Guard {truncate(GUARD)} -&gt;</a> : <span className="px-3 py-1.5 bg-card border border-border rounded-full font-mono text-mute">Guard not configured</span>}
          {SIGNER ? <a href={`https://www.oklink.com/xlayer/address/${SIGNER}`} className="px-3 py-1.5 bg-card border border-border rounded-full hover:border-ok transition font-mono">Signer {truncate(SIGNER)} -&gt;</a> : <span className="px-3 py-1.5 bg-card border border-border rounded-full font-mono text-mute">Signer not configured</span>}
        </div>
      </header>

      <section className="mb-16">
        <div className="flex items-baseline justify-between mb-6"><h2 className="text-2xl font-semibold">Policy profile</h2><span className="text-xs text-mute">Profiles override each scenario's default limits</span></div>
        <div className="grid md:grid-cols-4 gap-3">
          <button onClick={() => setProfile(null)} className={`text-left p-4 bg-card border rounded-lg transition ${profile === null ? "border-ok" : "border-border hover:border-gray-700"}`}><div className="font-medium mb-1 text-sm">Scenario defaults</div><div className="text-xs text-mute">Use the preset's own policy.</div></button>
          {POLICY_PROFILES.map((p) => <button key={p.id} onClick={() => setProfile(p)} className={`text-left p-4 bg-card border rounded-lg transition ${profile?.id === p.id ? "border-ok" : "border-border hover:border-gray-700"}`}><div className="font-medium mb-1 text-sm">{p.name}</div><div className="text-xs text-mute leading-snug">{p.description}</div></button>)}
        </div>
      </section>

      <section className="mb-16">
        <div className="flex items-baseline justify-between mb-6"><h2 className="text-2xl font-semibold">Run a live preflight</h2><span className="text-xs text-mute">live against X Layer mainnet</span></div>
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {PRESETS.map((p) => <button key={p.id} onClick={() => run(p)} disabled={loading} className={`text-left p-5 bg-card border rounded-lg transition ${selected.id === p.id ? "border-ok" : "border-border hover:border-gray-700"} disabled:opacity-50`}><div className="flex items-start justify-between mb-2"><span className="font-medium">{p.label}</span><span className={`text-xs px-2 py-0.5 rounded ${p.expectedOutcome === "pass" ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}>expects {p.expectedOutcome}</span></div><p className="text-sm text-gray-500 leading-snug">{p.description}</p></button>)}
        </div>
        <div className="bg-card border border-border rounded-lg p-6 min-h-[320px]">
          {loading && <div className="text-mute text-sm animate-pulse">Running preflight against OnchainOS, Uniswap, and X Layer RPC...</div>}
          {!loading && !result && <div className="text-mute text-sm">Pick a scenario above to run a live check.</div>}
          {!loading && result && <ResultPanel result={result} selected={selected} />}
        </div>
      </section>

      <section className="mb-16">
        <div className="flex items-baseline justify-between mb-4"><h2 className="text-2xl font-semibold">Live check feed</h2><span className="text-xs text-mute">updates every 5s</span></div>
        <div className="bg-card border border-border rounded-lg">
          {feed.length === 0 && <div className="p-6 text-mute text-sm">No checks yet. Run a scenario above.</div>}
          {feed.slice(0, 10).map((e) => <div key={e.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-b-0 text-xs font-mono"><span className={`h-2 w-2 rounded-full shrink-0 ${e.verdict === "pass" ? "bg-ok" : "bg-bad"}`} /><span className="text-mute w-16">{ago(e.timestamp)}</span><span className={`${e.verdict === "pass" ? "text-ok" : "text-bad"} w-16 shrink-0`}>{e.verdict === "pass" ? "SIGNED" : "BLOCKED"}</span><span className="text-gray-400 flex-1 truncate">{e.presetLabel ?? `${truncate(e.fromToken, 8, 4)} {" -> "} ${truncate(e.toToken, 8, 4)}`}</span>{e.reasonCode && <span className="text-bad shrink-0">{e.reasonCode}</span>}</div>)}
        </div>
      </section>

      <footer className="pt-10 border-t border-border text-xs text-mute">Built for the OKX Build X Hackathon. Signed plan matches the guard struct; the guard rejects invalid, expired, replayed, or tampered plans on-chain.</footer>
    </main>
  );
}

function ResultPanel({ result, selected }: { result: CheckResult; selected: Preset }) {
  if (result.error) return <div className="text-bad text-sm"><div className="font-medium mb-2">Error</div><div className="font-mono text-xs">{result.error}</div></div>;
  const passed = result.verdict === "pass";
  return <div>
    <div className="flex items-center gap-3 mb-5"><div className={`h-3 w-3 rounded-full ${passed ? "bg-ok animate-pulse" : "bg-bad"}`} /><div className="text-lg font-semibold">{passed ? "PASS / signed plan issued" : "BLOCKED"}</div>{!passed && result.failedReasonCodes[0] && <span className="font-mono text-xs bg-bad/10 text-bad px-2 py-0.5 rounded">{result.failedReasonCodes[0]}</span>}{selected.expectedReason && !passed && result.failedReasonCodes[0] === selected.expectedReason && <span className="text-xs text-mute">(matches expected outcome)</span>}</div>
    <div className="space-y-1 mb-5">{result.checks.map((c) => <div key={c.step} className="flex items-center gap-3 text-xs font-mono py-1.5 px-3 bg-black/30 rounded"><span className={c.pass ? "text-ok" : "text-bad"}>{c.pass ? "OK" : "NO"}</span><span className="text-gray-400 w-48">{c.step}</span><span className="text-mute truncate flex-1">{Object.entries(c.details).slice(0, 3).map(([k, v]) => `${k}=${truncate(String(v), 12, 8)}`).join("  ")}</span>{c.reasonCode && <span className="text-bad">{c.reasonCode}</span>}</div>)}</div>
    {passed && result.plan && result.signature && <div className="bg-black/30 border border-ok/30 rounded p-4 text-xs font-mono space-y-1"><div><span className="text-mute">signer</span> <span className="text-ok">{result.signer}</span></div><div><span className="text-mute">signature</span> <span>{truncate(result.signature, 16, 10)}</span></div><div><span className="text-mute">caller</span> <span>{truncate(result.plan.caller, 12, 8)}</span></div><div><span className="text-mute">route</span> <span>{truncate(result.plan.fromToken, 8, 4)} {" -> "} {truncate(result.plan.toToken, 8, 4)}</span></div><div><span className="text-mute">fromAmount</span> <span>{result.plan.fromAmount}</span></div><div><span className="text-mute">minToAmount</span> <span>{result.plan.minToAmount}</span></div><div><span className="text-mute">expires</span> <span>{new Date(result.plan.expiresAt * 1000).toISOString()}</span></div><div><span className="text-mute">approvalTarget</span> <span>{truncate(result.quote?.approvalTarget ?? "", 12, 8)}</span></div><div><span className="text-mute">expectedOut</span> <span>{result.quote?.expectedToAmount}</span></div><div><span className="text-mute">liq sources</span> <span>{result.quote?.liquiditySources.join(", ") || "n/a"}</span></div><div><span className="text-mute">token age</span> <span>{formatSeconds(result.quote?.tokenAgeSeconds)}</span></div><div><span className="text-mute">top10 hold</span> <span>{result.quote?.top10HoldPercent ?? "n/a"}</span></div><div className="pt-2 text-gray-400">Plan is EIP-712 signed and accepted by <code>PreflightGuard.verifySignature</code>. End-to-end execution through the OKX v6 aggregator requires a router that supports intermediary callers; see README for guard-compatible execution paths.</div></div>}
  </div>;
}


