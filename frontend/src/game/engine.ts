/**
 * Quasaria "mission control" — a purely cosmetic, frontend-only progression
 * layer. Progress lives in this browser's localStorage, keyed by wallet
 * address. XP has NO monetary value, is not a token, cannot be traded,
 * transferred or redeemed, and never touches a contract.
 *
 * Responsible-design rules (enforced here, not just in copy):
 *  - reward learning and safe actions (risk guide, calculators, slippage guard);
 *  - on-chain actions only count ONCE ("try it once"), regardless of amount;
 *  - nothing rewards leverage, trade volume, trade count, or deposit size;
 *  - no leaderboards.
 */

// ------------------------------------------------------------------ levels & ranks
export const RANKS = [
  { name: "Stardust", minLevel: 1, blurb: "Every quasar starts as a cloud of dust." },
  { name: "Comet", minLevel: 3, blurb: "You know your way around the system." },
  { name: "Nova", minLevel: 5, blurb: "Bright, curious and risk-aware." },
  { name: "Pulsar", minLevel: 7, blurb: "Steady habits, precise rhythm." },
  { name: "Quasar", minLevel: 9, blurb: "The brightest objects in the universe." },
] as const;
export type RankName = (typeof RANKS)[number]["name"];

/** Cumulative XP needed to reach level i+1 (index 0 = level 1). */
export const LEVEL_XP = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200] as const;
export const MAX_LEVEL = LEVEL_XP.length;

export function rankFor(level: number): (typeof RANKS)[number] {
  let r: (typeof RANKS)[number] = RANKS[0];
  for (const x of RANKS) if (level >= x.minLevel) r = x;
  return r;
}

export function levelFor(xp: number) {
  const x = Math.max(0, Math.floor(xp));
  let level = 1;
  for (let i = 0; i < LEVEL_XP.length; i++) if (x >= LEVEL_XP[i]) level = i + 1;
  const floor = LEVEL_XP[level - 1];
  const next = level < MAX_LEVEL ? LEVEL_XP[level] : null;
  const span = next === null ? 0 : next - floor;
  const into = x - floor;
  return { level, rank: rankFor(level).name as RankName, xp: x, floor, next, into, span, progress: next === null ? 1 : into / span };
}

// ------------------------------------------------------------------ quests
export type QuestKind = "learn" | "try" | "habit";
export type Quest = { id: string; title: string; desc: string; xp: number; kind: QuestKind; to?: string; cta?: string; steps?: number };

export const EXPLORE_PATHS = ["/markets", "/trade", "/pools", "/earn", "/stake"] as const;
export const CALCS = ["staking", "holder", "lp"] as const;
export type CalcId = (typeof CALCS)[number];

export const QUESTS: Quest[] = [
  { id: "risk-guide", kind: "learn", xp: 100, title: "Read the risk guide", desc: "Five minutes on liquidations, impermanent loss, finite reward reserves and what 'unaudited' means.", to: "/quests#risk-guide", cta: "Open guide" },
  { id: "calc-staking", kind: "learn", xp: 40, title: "Try the staking calculator", desc: "See how rewards stop when a pool's reserve runs dry.", to: "/calculators?c=staking", cta: "Open" },
  { id: "calc-holder", kind: "learn", xp: 40, title: "Try the QFX holder-yield calculator", desc: "Compare simple vs settled yield and the reserve runway.", to: "/calculators?c=holder", cta: "Open" },
  { id: "calc-lp", kind: "learn", xp: 40, title: "Try the liquidity calculator", desc: "Move the price slider and watch impermanent loss.", to: "/calculators?c=lp", cta: "Open" },
  { id: "slippage", kind: "learn", xp: 40, title: "Set your slippage guard", desc: "Adjust max slippage on the Trade swap panel before you swap.", to: "/trade", cta: "Trade" },
  { id: "explore", kind: "learn", xp: 60, title: "Tour the galaxy", desc: "Visit Markets, Trade, Pools, Earn and Stake.", steps: EXPLORE_PATHS.length },
  { id: "merch-visit", kind: "learn", xp: 20, title: "Visit the merch store", desc: "Take a look at the (coming soon) merch line. Just browsing: nothing is for sale and buying would never earn XP.", to: "/merch", cta: "Merch" },
  { id: "connect", kind: "try", xp: 50, title: "Connect a testnet wallet", desc: "Create an in-app account or connect Freighter on TESTNET." },
  { id: "first-swap", kind: "try", xp: 75, title: "Make your first swap", desc: "One-time: any amount of free testnet tokens counts. Extra swaps earn nothing.", to: "/trade", cta: "Trade" },
  { id: "first-mint", kind: "try", xp: 75, title: "Mint QFX once", desc: "One-time: mint any amount of QFX (1 QFX = 1 XLM, fully backed) on testnet.", to: "/rewards", cta: "Mint" },
  { id: "first-lp", kind: "try", xp: 75, title: "Add liquidity once", desc: "One-time: deposit any amount into a pool. Read about impermanent loss first.", to: "/pools", cta: "Pools" },
  { id: "first-lend", kind: "try", xp: 75, title: "Try lending once", desc: "One-time: supply any amount of a testnet asset on the Lend page. Read its risk box first. Amounts never matter.", to: "/lending", cta: "Lend" },
  { id: "first-stake", kind: "try", xp: 75, title: "Stake once", desc: "One-time: stake any amount in an Orbit pool on testnet.", to: "/stake", cta: "Stake" },
  { id: "streak-3", kind: "habit", xp: 100, title: "3-day visit streak", desc: "Check in on three days in a row.", steps: 3 },
  { id: "streak-7", kind: "habit", xp: 150, title: "7-day visit streak", desc: "Keep the streak alive for a week.", steps: 7 },
];
export const DAILY_XP = 10;
export const questById = (id: string) => QUESTS.find((q) => q.id === id);

// ------------------------------------------------------------------ badges
export type Badge = { id: string; name: string; desc: string; icon: BadgeIcon; hue: "violet" | "cyan" | "gold" | "green" | "rose"; when: (s: GameState) => boolean };
export type BadgeIcon = "spark" | "compass" | "shield" | "abacus" | "gauge" | "bolt" | "forge" | "drop" | "orbit" | "flame" | "nova" | "crown";

const done = (s: GameState, id: string) => !!s.done[id];
export const BADGES: Badge[] = [
  { id: "first-light", name: "First Light", desc: "Connected a testnet wallet.", icon: "spark", hue: "cyan", when: (s) => done(s, "connect") },
  { id: "navigator", name: "Navigator", desc: "Toured every part of the app.", icon: "compass", hue: "violet", when: (s) => done(s, "explore") },
  { id: "risk-aware", name: "Risk Aware", desc: "Read the risk guide.", icon: "shield", hue: "green", when: (s) => done(s, "risk-guide") },
  { id: "calculated", name: "Calculated", desc: "Tried all three calculators.", icon: "abacus", hue: "gold", when: (s) => CALCS.every((c) => done(s, `calc-${c}`)) },
  { id: "guardian", name: "Slippage Guardian", desc: "Set a slippage guard.", icon: "gauge", hue: "cyan", when: (s) => done(s, "slippage") },
  { id: "lightspeed", name: "Lightspeed", desc: "Made a first testnet swap.", icon: "bolt", hue: "violet", when: (s) => done(s, "first-swap") },
  { id: "forge", name: "Star Forge", desc: "Minted QFX once.", icon: "forge", hue: "gold", when: (s) => done(s, "first-mint") },
  { id: "liquid-light", name: "Liquid Light", desc: "Added liquidity once.", icon: "drop", hue: "cyan", when: (s) => done(s, "first-lp") },
  { id: "first-orbit", name: "First Orbit", desc: "Staked once.", icon: "orbit", hue: "violet", when: (s) => done(s, "first-stake") },
  { id: "constellation", name: "Constellation", desc: "3-day visit streak.", icon: "flame", hue: "rose", when: (s) => done(s, "streak-3") },
  { id: "supernova", name: "Supernova", desc: "7-day visit streak.", icon: "nova", hue: "gold", when: (s) => done(s, "streak-7") },
  { id: "quasar-rank", name: "Quasar", desc: "Reached the Quasar rank.", icon: "crown", hue: "violet", when: (s) => levelFor(s.xp).level >= RANKS[4].minLevel },
];

// ------------------------------------------------------------------ state
export type GameState = {
  v: 1;
  xp: number;
  done: Record<string, number>;
  badges: Record<string, number>;
  visited: string[];
  streak: { count: number; best: number; last: string | null };
};
export const emptyState = (): GameState => ({ v: 1, xp: 0, done: {}, badges: {}, visited: [], streak: { count: 0, best: 0, last: null } });

export type GameEvent =
  | { type: "xp"; amount: number; reason: string }
  | { type: "quest"; quest: Quest }
  | { type: "badge"; badge: Badge }
  | { type: "level"; level: number; rank: RankName };

/** Local calendar day, YYYY-MM-DD. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const prevDay = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
};

function settle(before: GameState, s: GameState, events: GameEvent[], now: number): { state: GameState; events: GameEvent[] } {
  for (const b of BADGES) if (!s.badges[b.id] && b.when(s)) { s.badges = { ...s.badges, [b.id]: now }; events.push({ type: "badge", badge: b }); }
  const l0 = levelFor(before.xp).level, l1 = levelFor(s.xp).level;
  if (l1 > l0) events.push({ type: "level", level: l1, rank: levelFor(s.xp).rank });
  return { state: s, events };
}

/** Complete a quest once. Unknown or already-done quests are a no-op. */
export function complete(state: GameState, id: string, now = Date.now()) {
  const q = questById(id);
  if (!q || state.done[id]) return { state, events: [] as GameEvent[] };
  const s: GameState = { ...state, xp: state.xp + q.xp, done: { ...state.done, [id]: now } };
  return settle(state, s, [{ type: "quest", quest: q }, { type: "xp", amount: q.xp, reason: q.title }], now);
}

/** Record a page visit (for the "Tour the galaxy" and "Visit the merch store" quests). */
export function visit(state: GameState, path: string, now = Date.now()) {
  if ((path === "/merch" || path.startsWith("/merch/")) && !state.done["merch-visit"]) return complete(state, "merch-visit", now);
  const p = EXPLORE_PATHS.find((x) => path === x || path.startsWith(`${x}/`));
  if (!p || state.visited.includes(p)) return { state, events: [] as GameEvent[] };
  const s = { ...state, visited: [...state.visited, p] };
  if (EXPLORE_PATHS.every((x) => s.visited.includes(x))) return complete(s, "explore", now);
  return { state: s, events: [] as GameEvent[] };
}

/** Daily check-in: extends or resets the streak and grants DAILY_XP once per day. */
export function checkIn(state: GameState, today: string, now = Date.now()) {
  if (state.streak.last === today) return { state, events: [] as GameEvent[] };
  const count = state.streak.last && prevDay(today) === state.streak.last ? state.streak.count + 1 : 1;
  let s: GameState = { ...state, xp: state.xp + DAILY_XP, streak: { count, best: Math.max(state.streak.best, count), last: today } };
  let events: GameEvent[] = [{ type: "xp", amount: DAILY_XP, reason: "Daily check-in" }];
  const r0 = settle(state, s, events, now);
  s = r0.state; events = r0.events;
  for (const [id, need] of [["streak-3", 3], ["streak-7", 7]] as const) {
    if (count >= need) { const r = complete(s, id, now); s = r.state; events = [...events, ...r.events]; }
  }
  return { state: s, events };
}

/**
 * Map a confirmed transaction label (from useTx) to a one-time quest.
 * Deliberately NOT mapped: leverage ("open position", "set operator", "close"),
 * order-book offers, withdrawals, unstake/claim, redeem — and no volume/size.
 */
export function questForTx(label: string): string | null {
  const l = label.trim().toLowerCase();
  if (l === "swap") return "first-swap";
  if (l === "mint qfx") return "first-mint";
  if (l === "deposit" || l === "native lp deposit") return "first-lp";
  if (l === "stake") return "first-stake";
  if (l === "lend supply") return "first-lend";
  return null;
}

/** Defensive parse of stored JSON (bad or foreign data -> fresh state). */
export function parseState(raw: string | null): GameState {
  if (!raw) return emptyState();
  try {
    const o = JSON.parse(raw);
    if (!o || o.v !== 1 || typeof o.xp !== "number") return emptyState();
    const e = emptyState();
    return {
      v: 1,
      xp: Math.max(0, Math.min(o.xp, 1e6)),
      done: typeof o.done === "object" && o.done ? o.done : e.done,
      badges: typeof o.badges === "object" && o.badges ? o.badges : e.badges,
      visited: Array.isArray(o.visited) ? o.visited.filter((x: unknown) => typeof x === "string") : e.visited,
      streak: o.streak && typeof o.streak.count === "number" ? { count: o.streak.count, best: o.streak.best ?? o.streak.count, last: o.streak.last ?? null } : e.streak,
    };
  } catch {
    return emptyState();
  }
}

export const storageKey = (address: string | null) => `quasaria.game.v1:${address ?? "guest"}`;
export const SOUND_KEY = "quasaria.game.sound";
