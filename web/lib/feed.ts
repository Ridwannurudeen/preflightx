export type FeedEntry = {
  id: string;
  timestamp: number;
  verdict: "pass" | "fail";
  fromToken: string;
  toToken: string;
  fromSymbol?: string;
  toSymbol?: string;
  amount: string;
  reasonCode?: string;
  signer?: string;
  presetLabel?: string;
};

type FeedState = { entries: FeedEntry[] };

const GLOBAL_KEY = "__preflightx_feed";
type GlobalWithFeed = typeof globalThis & { [GLOBAL_KEY]?: FeedState };

function getState(): FeedState {
  const g = globalThis as GlobalWithFeed;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { entries: [] };
  return g[GLOBAL_KEY]!;
}

export function pushEntry(entry: Omit<FeedEntry, "id" | "timestamp">): FeedEntry {
  const full: FeedEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };
  const state = getState();
  state.entries.unshift(full);
  if (state.entries.length > 50) state.entries.length = 50;
  return full;
}

export function readEntries(): FeedEntry[] {
  return [...getState().entries];
}
