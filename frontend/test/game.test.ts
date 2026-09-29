import { describe, expect, it } from "vitest";
import { BADGES, checkIn, complete, DAILY_XP, emptyState, EXPLORE_PATHS, levelFor, parseState, questForTx, QUESTS, rankFor, visit } from "../src/game/engine";

describe("game engine (cosmetic XP layer)", () => {
  it("maps XP to levels and space ranks", () => {
    expect(levelFor(0)).toMatchObject({ level: 1, rank: "Stardust", progress: 0 });
    expect(levelFor(250).level).toBe(3);
    expect(rankFor(3).name).toBe("Comet");
    expect(rankFor(5).name).toBe("Nova");
    expect(rankFor(7).name).toBe("Pulsar");
    expect(levelFor(99999)).toMatchObject({ level: 10, rank: "Quasar", next: null, progress: 1 });
  });

  it("awards a quest once and unlocks its badge", () => {
    const a = complete(emptyState(), "risk-guide", 1);
    expect(a.state.xp).toBe(100);
    expect(a.events.map((e) => e.type)).toEqual(["quest", "xp", "badge", "level"]);
    const b = complete(a.state, "risk-guide", 2);
    expect(b.state).toBe(a.state);
    expect(b.events).toEqual([]);
  });

  it("only maps one-time, non-leverage transactions to quests", () => {
    expect(questForTx("swap")).toBe("first-swap");
    expect(questForTx("Mint QFX")).toBe("first-mint");
    expect(questForTx("native LP deposit")).toBe("first-lp");
    expect(questForTx("stake")).toBe("first-stake");
    for (const l of ["open position", "set operator", "close", "buy offer", "sell offer", "withdraw", "unstake", "claim", "Redeem QFX", "Credit yield", "set referrer"]) expect(questForTx(l)).toBeNull();
    // a second swap earns nothing
    const s = complete(emptyState(), "first-swap").state;
    expect(complete(s, "first-swap").state.xp).toBe(s.xp);
  });

  it("never rewards leverage, volume, trade count or deposit size", () => {
    const text = QUESTS.map((q) => `${q.id} ${q.title}`).join(" ").toLowerCase();
    expect(text).not.toMatch(/leverage|volume|position|trades\b|\bdeposit \d/);
    expect(BADGES.some((b) => /leverage|volume|whale/i.test(`${b.id} ${b.name} ${b.desc}`))).toBe(false);
  });

  it("tracks daily streaks and streak quests", () => {
    let s = emptyState();
    s = checkIn(s, "2026-09-26").state;
    expect(s.xp).toBe(DAILY_XP);
    expect(checkIn(s, "2026-09-26").state).toBe(s); // same day: no-op
    s = checkIn(s, "2026-09-27").state;
    const r = checkIn(s, "2026-09-28");
    expect(r.state.streak).toMatchObject({ count: 3, best: 3 });
    expect(r.state.done["streak-3"]).toBeTruthy();
    const gap = checkIn(r.state, "2026-10-02").state;
    expect(gap.streak).toMatchObject({ count: 1, best: 3 });
  });

  it("completes the tour after visiting every section", () => {
    let s = emptyState();
    for (const p of EXPLORE_PATHS.slice(0, -1)) s = visit(s, p).state;
    expect(s.done.explore).toBeUndefined();
    s = visit(s, `${EXPLORE_PATHS[EXPLORE_PATHS.length - 1]}`).state;
    expect(s.done.explore).toBeTruthy();
    expect(s.badges.navigator).toBeTruthy();
  });

  it("parses stored state defensively", () => {
    expect(parseState(null)).toEqual(emptyState());
    expect(parseState("{bad json")).toEqual(emptyState());
    expect(parseState(JSON.stringify({ v: 2, xp: 5 }))).toEqual(emptyState());
    expect(parseState(JSON.stringify({ v: 1, xp: 1e12, done: { connect: 1 } })).xp).toBe(1e6);
  });
});
