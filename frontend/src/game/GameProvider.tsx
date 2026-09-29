import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useWallet } from "../lib/wallet";
import { CALCS, checkIn, complete, dayKey, emptyState, levelFor, parseState, questForTx, SOUND_KEY, storageKey, visit, type CalcId, type GameEvent, type GameState } from "./engine";
import { burst, chime } from "./fx";
import BadgeIcon from "./BadgeIcon";

/** Event other components dispatch after a confirmed transaction (see useTx in components/ui.tsx). */
export const TX_EVENT = "quasaria:tx";

type Toast = { id: number; ev: GameEvent };
type Ctx = {
  state: GameState;
  info: ReturnType<typeof levelFor>;
  owner: string | null;
  sound: boolean;
  setSound: (on: boolean) => void;
  completeQuest: (id: string) => void;
  celebrate: (x?: number, y?: number) => void;
  reset: () => void;
};
const GameCtx = createContext<Ctx | null>(null);
export const useGame = () => useContext(GameCtx);

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export function GameProvider({ children }: { children: ReactNode }) {
  const w = useWallet();
  const loc = useLocation();
  const owner = w.address ?? null;
  const key = storageKey(owner);
  const [state, setState] = useState<GameState>(() => parseState(read(key)));
  const ref = useRef(state);
  const [sound, setSoundState] = useState(() => read(SOUND_KEY) === "on"); // OFF by default
  const soundRef = useRef(sound);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const ownerRef = useRef(owner);

  const setSound = useCallback((on: boolean) => { soundRef.current = on; setSoundState(on); write(SOUND_KEY, on ? "on" : "off"); if (on) chime("quest"); }, []);

  const react = useCallback((events: GameEvent[]) => {
    if (!events.length) return;
    const shown = events.filter((e) => e.type !== "xp" || !events.some((x) => x.type === "quest"));
    setToasts((t) => [...t, ...shown.map((ev) => ({ id: ++seq.current, ev }))].slice(-4));
    const big = events.some((e) => e.type === "badge" || e.type === "level");
    const anyQuest = events.some((e) => e.type === "quest");
    if (big || anyQuest) {
      const anchor = document.querySelector(".lvl-badge")?.getBoundingClientRect();
      burst(anchor ? anchor.left + anchor.width / 2 : undefined, anchor ? anchor.bottom : undefined, big ? 90 : 50);
    }
    if (soundRef.current) chime(events.some((e) => e.type === "level") ? "level" : big ? "badge" : "quest");
  }, []);

  const apply = useCallback((fn: (s: GameState) => { state: GameState; events: GameEvent[] }) => {
    const r = fn(ref.current);
    if (r.state === ref.current) return;
    ref.current = r.state;
    setState(r.state);
    write(storageKey(ownerRef.current), JSON.stringify(r.state));
    react(r.events);
  }, [react]);

  // Load progress for the current wallet (first connect adopts the guest progress once).
  useEffect(() => {
    ownerRef.current = owner;
    let s = parseState(read(key));
    if (owner && !read(key)) {
      const guest = read(storageKey(null));
      if (guest) s = parseState(guest);
    }
    ref.current = s;
    setState(s);
    write(key, JSON.stringify(s));
    apply((x) => checkIn(x, dayKey(new Date())));
    if (owner) apply((x) => complete(x, "connect"));
  }, [key, owner, apply]);

  // Page tour.
  useEffect(() => { apply((x) => visit(x, loc.pathname)); }, [loc.pathname, apply, key]);

  // One-time on-chain "try it" quests, from confirmed transactions only.
  useEffect(() => {
    const on = (e: Event) => {
      const q = questForTx(String((e as CustomEvent).detail?.label ?? ""));
      if (q) apply((x) => complete(x, q));
    };
    window.addEventListener(TX_EVENT, on);
    return () => window.removeEventListener(TX_EVENT, on);
  }, [apply]);

  // Learning quests, detected from interaction (no page changes needed):
  //  - using any input/chip inside a calculator card completes that calculator's quest;
  //  - moving a range input whose field label mentions "slippage" completes the slippage quest.
  useEffect(() => {
    const on = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest) return;
      const calc = t.closest<HTMLElement>("[data-testid^='calc-']")?.dataset.testid?.replace("calc-", "");
      if (calc && (CALCS as readonly string[]).includes(calc) && (e.type !== "click" || t.closest("button, [role=radio], .chip"))) apply((x) => complete(x, `calc-${calc as CalcId}`));
      if (e.type !== "click" && t instanceof HTMLInputElement && t.type === "range" && /slippage/i.test(t.closest(".field")?.textContent ?? "")) apply((x) => complete(x, "slippage"));
    };
    document.addEventListener("input", on, true);
    document.addEventListener("change", on, true);
    document.addEventListener("click", on, true);
    return () => { document.removeEventListener("input", on, true); document.removeEventListener("change", on, true); document.removeEventListener("click", on, true); };
  }, [apply]);

  const value = useMemo<Ctx>(() => ({
    state,
    info: levelFor(state.xp),
    owner,
    sound,
    setSound,
    completeQuest: (id) => apply((x) => complete(x, id)),
    celebrate: (x, y) => { burst(x, y, 60); if (soundRef.current) chime("quest"); },
    reset: () => { const s = emptyState(); ref.current = s; setState(s); write(key, JSON.stringify(s)); },
  }), [state, owner, sound, setSound, apply, key]);

  return (
    <GameCtx.Provider value={value}>
      {children}
      <GameToasts toasts={toasts} onDone={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </GameCtx.Provider>
  );
}

function GameToasts({ toasts, onDone }: { toasts: Toast[]; onDone: (id: number) => void }) {
  return (
    <div className="game-toasts" role="status" aria-live="polite">
      {toasts.map((t) => <ToastItem key={t.id} t={t} onDone={onDone} />)}
    </div>
  );
}

function ToastItem({ t, onDone }: { t: Toast; onDone: (id: number) => void }) {
  useEffect(() => { const h = setTimeout(() => onDone(t.id), t.ev.type === "xp" ? 3200 : 5200); return () => clearTimeout(h); }, [t, onDone]);
  const ev = t.ev;
  return (
    <div className={`game-toast ${ev.type}`} onClick={() => onDone(t.id)}>
      {ev.type === "badge" ? <BadgeIcon badge={ev.badge} unlocked size={44} /> : <span className="gt-ico" aria-hidden>{ev.type === "level" ? "▲" : ev.type === "quest" ? "✓" : "✦"}</span>}
      <div>
        <div className="gt-kicker">{ev.type === "badge" ? "Achievement unlocked" : ev.type === "level" ? "Level up" : ev.type === "quest" ? "Quest complete" : "XP"}</div>
        <div className="gt-title">
          {ev.type === "badge" ? ev.badge.name : ev.type === "level" ? `Level ${ev.level} · ${ev.rank}` : ev.type === "quest" ? ev.quest.title : ev.reason}
        </div>
        <div className="gt-sub">
          {ev.type === "badge" ? ev.badge.desc : ev.type === "quest" ? `+${ev.quest.xp} XP` : ev.type === "xp" ? `+${ev.amount} XP` : "New rank perks: bragging rights only. XP has no monetary value."}
        </div>
      </div>
    </div>
  );
}
