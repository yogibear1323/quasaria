import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { WalletContext, type WalletState } from "../src/lib/wallet";
import AccountModal, { initialModalState } from "../src/components/AccountModal";
import { pendingKeypair } from "../src/lib/keys";

// Minimal sessionStorage for the node test env.
const store = new Map<string, string>();
(globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
const noop = () => {}; const anoop = async () => {};
const wallet = (over: Partial<WalletState>): WalletState => ({
  address: null, kind: null, funded: null, error: null, stored: null, modalOpen: true, modalIntent: "create",
  openModal: noop, closeModal: noop, loginWithSecret: anoop, unlockStored: anoop, forgetKey: noop, disconnect: noop,
  refreshFunded: async () => null, sign: async (x: string) => x, ...over,
});
const addr = (h: string) => (h.match(/data-testid="new-public"[^>]*>([^<]*)</) || h.match(/G[A-Z2-7]{55}/) || [])[1] ?? (h.match(/G[A-Z2-7]{55}/) || [])[0];
const render = () => renderToStaticMarkup(<MemoryRouter><WalletContext.Provider value={wallet({})}><AccountModal /></WalletContext.Provider></MemoryRouter>);

afterEach(() => { pendingKeypair.clear(); store.clear(); });

describe("a generated keypair stays the same until confirmed or discarded", () => {
  it("re-mounting the create screen (route change, StrictMode double render, tab return) shows the same keypair", () => {
    const a = initialModalState("create", false, null).acct!;
    const b = initialModalState("create", false, null).acct!;
    expect(b.publicKey).toBe(a.publicKey);
    expect(b.secret).toBe(a.secret);
    const h1 = render(), h2 = render();
    expect(h1).toContain(a.publicKey);
    expect(h2).toContain(a.publicKey);
    expect(addr(h2)).toBe(addr(h1));
  });
  it("survives a reload: the pending keypair is restored from sessionStorage, not localStorage", () => {
    const a = pendingKeypair.getOrCreate();
    expect([...store.values()].join()).toContain(a.publicKey);
    // simulate a fresh page: drop the in-memory copy by clearing then re-seeding only storage
    const raw = store.get("quasaria.pending-keypair.v1")!;
    pendingKeypair.clear(); store.set("quasaria.pending-keypair.v1", raw);
    expect(pendingKeypair.get()?.publicKey).toBe(a.publicKey);
    expect(readFileSync(new URL("../src/lib/keys.ts", import.meta.url), "utf8")).not.toMatch(/localStorage\.setItem\(PENDING_KEY/);
  });
  it("is cleared on confirm or discard, after which a new keypair is generated", () => {
    const a = pendingKeypair.getOrCreate();
    pendingKeypair.clear();
    expect(pendingKeypair.get()).toBeNull();
    expect(pendingKeypair.getOrCreate().publicKey).not.toBe(a.publicKey);
    const src = readFileSync(new URL("../src/components/AccountModal.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/loginWithSecret[\s\S]{0,120}pendingKeypair\.clear\(\)/);
    expect(src).toContain("I saved my secret key");
  });
  it("auto-reload for a new deploy is skipped while a keypair is pending", () => {
    expect(readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8")).toMatch(/pending-keypair\.v1"\)\) return;/);
  });
});
