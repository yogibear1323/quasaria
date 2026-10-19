import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Keypair } from "@stellar/stellar-sdk";
import { WalletContext, type WalletState } from "../src/lib/wallet";
import AccountModal, { initialModalState } from "../src/components/AccountModal";

// Throwaway testnet keypair generated per run; never printed.
const throwaway = () => { const k = Keypair.random(); return { publicKey: k.publicKey(), secret: k.secret() }; };
const SAVED = { publicKey: Keypair.random().publicKey(), v: 1 } as unknown as WalletState["stored"];
const noop = () => {}; const anoop = async () => {};
const wallet = (over: Partial<WalletState>): WalletState => ({
  address: null, kind: null, funded: null, error: null, stored: null, modalOpen: true, modalIntent: null,
  openModal: noop, closeModal: noop, loginWithSecret: anoop, unlockStored: anoop, forgetKey: noop, disconnect: noop,
  refreshFunded: async () => null, sign: async (x: string) => x, ...over,
});
const render = (w: WalletState) => renderToStaticMarkup(<MemoryRouter><WalletContext.Provider value={w}><AccountModal /></WalletContext.Provider></MemoryRouter>);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const testid = (h: string, id: string) => (h.match(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`)) || [])[1];

describe("account creation (bug: Create opened 'Unlock saved key' and the secret never appeared)", () => {
  it("Create ALWAYS goes to the new-keypair reveal step, even with a passphrase-encrypted key saved in the browser", () => {
    expect(initialModalState("create", true, null, throwaway).step).toBe("reveal");
    expect(initialModalState("create", false, null, throwaway).step).toBe("reveal");
    expect(initialModalState(null, true, null).step).toBe("choose"); // header "Create / sign in" → chooser, not unlock
    expect(initialModalState("unlock", true, null).step).toBe("unlock"); // unlock only when explicitly asked
    expect(initialModalState("unlock", false, null).step).toBe("choose");
  });

  it("with a saved key + Create: the secret panel appears with the full S… key, full G address, copy, reveal, warning and the required 'I saved it' box", () => {
    const h = render(wallet({ stored: SAVED, modalIntent: "create" }));
    expect(text(h)).not.toMatch(/Unlock saved key/);
    expect(h).toContain('data-testid="secret-panel"');
    const sec = testid(h, "secret-value")!, addr = testid(h, "new-address")!;
    expect(sec).toMatch(/^S[A-Z2-7]{55}$/);
    expect(addr).toMatch(/^G[A-Z2-7]{55}$/);
    expect(Keypair.fromSecret(sec).publicKey()).toBe(addr);
    expect(text(h)).toMatch(/Copy secret/); expect(text(h)).toMatch(/Copy address/); expect(h).toContain('data-testid="reveal-toggle"');
    expect(text(h)).toMatch(/cannot be recovered/i);
    expect(h).toMatch(/data-testid="saved-checkbox"/);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Continue</); // Continue is gated on the checkbox
    expect(h).toContain('data-testid="stored-key-note"'); expect(text(h)).toMatch(/does not replace it unless you choose/);
  });

  it("without a saved key, Create also shows the secret panel and the full address", () => {
    const h = render(wallet({ modalIntent: "create" }));
    expect(testid(h, "secret-value")).toMatch(/^S[A-Z2-7]{55}$/);
    expect(testid(h, "new-address")).toMatch(/^G[A-Z2-7]{55}$/);
    expect(h).not.toContain('data-testid="stored-key-note"');
  });

  it("the unlock screen offers 'Use a different account / Create new' and 'Forget saved key' with a cannot-recover confirm", () => {
    const h = render(wallet({ stored: SAVED, modalIntent: "unlock" }));
    expect(text(h)).toMatch(/Unlock saved key/);
    expect(text(h)).toMatch(/Use a different account \/ Create new/);
    expect(text(h)).toMatch(/Forget saved key/);
    expect(h).toMatch(/data-testid="unlock-actions"|style="flex-wrap:wrap"[^>]*data-testid="unlock-actions"/);
    expect(h).toMatch(/flex-wrap:wrap[^>]*data-testid="unlock-actions"/); // buttons must wrap at 390 px
    expect(readFileSync(new URL("../src/components/AccountModal.tsx", import.meta.url), "utf8")).toMatch(/cannot be recovered without its secret key/);
  });

  it("the fund screen renders the full 56-character address (no truncating input)", () => {
    const k = throwaway();
    const h = render(wallet({ address: k.publicKey, modalIntent: "fund" }));
    expect(testid(h, "fund-address")).toBe(k.publicKey);
  });

  it("keys are wrapped, never logged, and the header CTA never routes Create to unlock", () => {
    const src = readFileSync(new URL("../src/components/AccountModal.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/console\.|analytics|track\(/);
    expect(src).not.toMatch(/<input[^>]*value=\{acct\.(secret|publicKey)\}/);
    expect(readFileSync(new URL("../src/theme/global.css", import.meta.url), "utf8")).toMatch(/\.key-block \{[^}]*word-break: break-all/);
    const layout = readFileSync(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
    expect(layout).not.toMatch(/w\.stored \? "Unlock key"/);
  });
});
