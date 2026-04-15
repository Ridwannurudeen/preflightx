"use client";

import { useEffect, useState } from "react";
import { PRESETS, POLICY_PROFILES, type Preset, type PolicyProfile } from "@/lib/presets";

type CheckResult = {
  verdict: "pass" | "fail";
  checks: Array<{
    step: string;
    pass: boolean;
    details: Record<string, unknown>;
    reasonCode?: string;
  }>;
  failedReasonCodes: string[];
  plan?: {
    intent: { fromToken: string; toToken: string; amount: string; caller: string };
    route: { source: string; fromAmount: string; toAmount: string; estimatedSlippageBps: number };
    expiresAt: number;
    nonce: string;
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

const GUARD = "0xccaeeb946a0511e0a1fd4497dd6f4e59294478eb";
const SIGNER = "0xd0C14e287fF6E0B0EC6591BC14FE66CB06FAa0AA";

function truncate(s: string, head = 10, tail = 6): string {
  if (!s || s.length <= head + tail + 2) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function ago(ms: number): string {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

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
      } catch {
        // ignore
      }
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
        body: JSON.stringify({
          intent: preset.intent,
          limits,
          presetLabel: profile ? `${preset.label} · ${profile.name}` : preset.label,
        }),
      });
      const data = (await res.json()) as CheckResult;
      setResult(data);
    } catch (e) {
      setResult({
        verdict: "fail",
        checks: [],
        failedReasonCodes: [],
        verifiedAt: Date.now(),
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="max-w-6xl mx-auto px-6 py-16">
      <header className="mb-16">
        <div className="text-xs uppercase tracking-widest text-mute mb-4">
          OKX Build X · Skill Arena
        </div>
        <h1 className="text-5xl font-bold mb-6 leading-tight">
          Preflight before you trade.
          <br />
          <span className="text-mute">Enforce it on-chain.</span>
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl leading-relaxed">
          PreflightX is a single-call verification skill for autonomous DeFi agents on X Layer.
          OnchainOS v6 aggregator + Uniswap AI cross-validation + direct X Layer RPC reads. On
          pass, you get an EIP-712 signed plan. The{" "}
          <code className="bg-card px-1.5 py-0.5 rounded text-sm">PreflightGuard</code> contract
          only forwards a swap if that signature is fresh, unused, and bound to the caller — so
          the slippage commitment is enforced by the chain, not by promise.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 text-xs">
          <a
            href="https://github.com/Ridwannurudeen/preflightx"
            className="px-3 py-1.5 bg-card border border-border rounded-full hover:border-ok transition"
          >
            GitHub →
          </a>
          <a
            href={`https://www.oklink.com/xlayer/address/${GUARD}`}
            className="px-3 py-1.5 bg-card border border-border rounded-full hover:border-ok transition font-mono"
          >
            Guard {truncate(GUARD)} →
          </a>
          <a
            href={`https://www.oklink.com/xlayer/address/${SIGNER}`}
            className="px-3 py-1.5 bg-card border border-border rounded-full hover:border-ok transition font-mono"
          >
            Signer {truncate(SIGNER)} →
          </a>
        </div>
      </header>

      <section className="mb-16">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="text-2xl font-semibold">Policy profile</h2>
          <span className="text-xs text-mute">{profile ? "enforced against every check below" : "scenario defaults applied"}</span>
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          <button
            onClick={() => setProfile(null)}
            className={`text-left p-4 bg-card border rounded-lg transition ${
              profile === null ? "border-ok" : "border-border hover:border-gray-700"
            }`}
          >
            <div className="font-medium mb-1 text-sm">Scenario defaults</div>
            <div className="text-xs text-mute">Each scenario brings its own limits.</div>
          </button>
          {POLICY_PROFILES.map((p) => (
            <button
              key={p.id}
              onClick={() => setProfile(p)}
              className={`text-left p-4 bg-card border rounded-lg transition ${
                profile?.id === p.id ? "border-ok" : "border-border hover:border-gray-700"
              }`}
            >
              <div className="font-medium mb-1 text-sm">{p.name}</div>
              <div className="text-xs text-mute leading-snug">{p.description}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="mb-16">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="text-2xl font-semibold">Try a trade. See what PreflightX blocks.</h2>
          <span className="text-xs text-mute">live against X Layer mainnet</span>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => run(p)}
              disabled={loading}
              className={`text-left p-5 bg-card border rounded-lg transition ${
                selected.id === p.id ? "border-ok" : "border-border hover:border-gray-700"
              } disabled:opacity-50`}
            >
              <div className="flex items-start justify-between mb-2">
                <span className="font-medium">{p.label}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    p.expectedOutcome === "pass"
                      ? "bg-ok/10 text-ok"
                      : "bg-bad/10 text-bad"
                  }`}
                >
                  expects {p.expectedOutcome}
                </span>
              </div>
              <p className="text-sm text-gray-500 leading-snug">{p.description}</p>
            </button>
          ))}
        </div>

        <div className="bg-card border border-border rounded-lg p-6 min-h-[320px]">
          {loading && (
            <div className="text-mute text-sm animate-pulse">
              Running preflight against OnchainOS + Uniswap AI + X Layer RPC…
            </div>
          )}
          {!loading && !result && (
            <div className="text-mute text-sm">Pick a scenario above to run a live check.</div>
          )}
          {!loading && result && <ResultPanel result={result} selected={selected} />}
        </div>
      </section>

      <section className="mb-16">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-2xl font-semibold">Live check feed</h2>
          <span className="text-xs text-mute">updates every 5s · last 50 checks across all visitors</span>
        </div>
        <div className="bg-card border border-border rounded-lg">
          {feed.length === 0 && (
            <div className="p-6 text-mute text-sm">
              No checks yet. Run a scenario above — it appears here and in every other visitor's feed.
            </div>
          )}
          {feed.slice(0, 10).map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-b-0 text-xs font-mono"
            >
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  e.verdict === "pass" ? "bg-ok" : "bg-bad"
                }`}
              />
              <span className="text-mute w-16">{ago(e.timestamp)}</span>
              <span
                className={`${e.verdict === "pass" ? "text-ok" : "text-bad"} w-16 shrink-0`}
              >
                {e.verdict === "pass" ? "SIGNED" : "BLOCKED"}
              </span>
              <span className="text-gray-400 flex-1 truncate">
                {e.presetLabel ??
                  `${truncate(e.fromToken, 8, 4)} → ${truncate(e.toToken, 8, 4)}`}
              </span>
              {e.reasonCode && (
                <span className="text-bad shrink-0">{e.reasonCode}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mb-16">
        <h2 className="text-2xl font-semibold mb-6">How it works</h2>
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          {[
            ["1. Dual-source route", "OnchainOS v6 /dex/aggregator/swap + Uniswap AI in parallel."],
            ["2. Cross-source divergence", "Blocks trades where the two engines disagree > 50 bps."],
            ["3. ERC-20 balance", "viem readContract balanceOf on X Layer."],
            ["4. ERC-20 allowance", "viem readContract allowance(caller, router)."],
            ["5. Route simulation", "OKX v6 aggregator simulates internally before returning calldata."],
            ["6. Token safety", "isHoneyPot flag + taxRate from the v6 swap response."],
            ["7. Slippage envelope", "Quoted slippage ≤ caller's maxSlippageBps."],
            ["7b. Price deviation", "v6 /dex/market/candles — current price within 1000 bps of recent mean."],
            ["8. Quote freshness", "Reject quotes older than maxStaleQuoteSeconds."],
            ["9. Portfolio policy", "Trade USD ≤ maxPortfolioImpactPct of fromToken balance."],
            ["10. Gas pricing", "gasPrice × gasLimit from v6 swap response."],
            ["11. Sign plan", "EIP-712 typed data, recoverable to PreflightX signer."],
          ].map(([title, body]) => (
            <div key={title} className="bg-card border border-border rounded p-4">
              <div className="font-medium mb-1">{title}</div>
              <div className="text-gray-500 text-xs leading-relaxed">{body}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="pt-10 border-t border-border text-xs text-mute">
        Built for the OKX Build X Hackathon — Skill Arena. MIT licensed. No LLM-as-judge.
      </footer>
    </main>
  );
}

function ResultPanel({ result, selected }: { result: CheckResult; selected: Preset }) {
  if (result.error) {
    return (
      <div className="text-bad text-sm">
        <div className="font-medium mb-2">Error</div>
        <div className="font-mono text-xs">{result.error}</div>
      </div>
    );
  }

  const passed = result.verdict === "pass";
  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <div
          className={`h-3 w-3 rounded-full ${passed ? "bg-ok animate-pulse" : "bg-bad"}`}
        />
        <div className="text-lg font-semibold">
          {passed ? "PASS — signed plan issued" : "BLOCKED"}
        </div>
        {!passed && result.failedReasonCodes[0] && (
          <span className="font-mono text-xs bg-bad/10 text-bad px-2 py-0.5 rounded">
            {result.failedReasonCodes[0]}
          </span>
        )}
        {selected.expectedReason &&
          !passed &&
          result.failedReasonCodes[0] === selected.expectedReason && (
            <span className="text-xs text-mute">(matches expected outcome)</span>
          )}
      </div>

      <div className="space-y-1 mb-5">
        {result.checks.map((c) => (
          <div
            key={c.step}
            className="flex items-center gap-3 text-xs font-mono py-1.5 px-3 bg-black/30 rounded"
          >
            <span className={c.pass ? "text-ok" : "text-bad"}>
              {c.pass ? "✓" : "✗"}
            </span>
            <span className="text-gray-400 w-48">{c.step}</span>
            <span className="text-mute truncate flex-1">
              {Object.entries(c.details)
                .slice(0, 3)
                .map(([k, v]) => `${k}=${truncate(String(v), 12, 8)}`)
                .join("  ")}
            </span>
            {c.reasonCode && <span className="text-bad">{c.reasonCode}</span>}
          </div>
        ))}
      </div>

      {passed && result.plan && result.signature && (
        <div className="bg-black/30 border border-ok/30 rounded p-4 text-xs font-mono space-y-1">
          <div>
            <span className="text-mute">signer</span>{" "}
            <span className="text-ok">{result.signer}</span>
          </div>
          <div>
            <span className="text-mute">signature</span>{" "}
            <span>{truncate(result.signature, 16, 10)}</span>
          </div>
          <div>
            <span className="text-mute">nonce</span>{" "}
            <span>{truncate(result.plan.nonce, 10, 8)}</span>
          </div>
          <div>
            <span className="text-mute">expires</span>{" "}
            <span>{new Date(result.plan.expiresAt).toISOString()}</span>
          </div>
          <div>
            <span className="text-mute">route</span>{" "}
            <span>
              {result.plan.route.fromAmount} → {result.plan.route.toAmount} (
              {result.plan.route.source}, {result.plan.route.estimatedSlippageBps} bps)
            </span>
          </div>
          <div className="pt-2 text-gray-400">
            Plan is ready for <code>PreflightGuard.executeWithPreflight(plan, signature)</code>.
          </div>
        </div>
      )}
    </div>
  );
}
