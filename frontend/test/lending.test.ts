import { describe, expect, it } from "vitest";
import { Account, Contract, Keypair, Networks, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  LENDING, addrv, applyAction, aprToApy, borrowRateBps, errorText, hfLabel, hfTone, i128v, labelFor, liquidationPrice,
  lendingAssetById, supplyRateBps, totals, txrep, utilizationBps, type PositionUsd,
} from "../src/lib/lending";
import { parseStellarToml, sep10Token, sep38Indicative, verifyChallenge, TEST_ANCHOR_DOMAIN } from "../src/lib/anchor";
import { questForTx } from "../src/game/engine";

const pos = (o: Partial<PositionUsd> & { sac: string }): PositionUsd => ({
  suppliedUsd: 0, borrowedUsd: 0, collateral: true, ltvBps: 8000, thresholdBps: 8500, collateralEnabled: true, supplyApy: 0, borrowApy: 0, ...o,
});

describe("lending config (deployed testnet pool)", () => {
  it("pool, oracle and every reserve have valid contract ids and canonical CODE:ISSUER ids", () => {
    expect(StrKey.isValidContract(LENDING.pool)).toBe(true);
    expect(StrKey.isValidContract(LENDING.oracle)).toBe(true);
    expect(LENDING.reserves.length).toBe(42);
    for (const r of LENDING.reserves) {
      expect(StrKey.isValidContract(r.sac), r.id).toBe(true);
      if (r.id === "XLM") { expect(r.canonical).toBe("XLM:native"); continue; }
      const [code, issuer] = r.canonical.split(":");
      expect(code, r.id).toMatch(/^[A-Za-z0-9]{1,12}$/);
      expect(StrKey.isValidEd25519PublicKey(issuer), r.id).toBe(true);
      const [tc, ti] = r.testnetCanonical.split(":");
      expect(tc).toBe(r.testnetCode);
      expect(ti).toBe(r.testnetIssuer);
    }
    expect(new Set(LENDING.reserves.map((r) => r.sac)).size).toBe(42);
  });
  it("risk params respect the bounds (bonus 5–8%, cap 10%, thr*(1+bonus)<1, ltv<=thr)", () => {
    for (const r of LENDING.reserves) {
      const c = r.config;
      expect(c.liq_bonus_bps, r.id).toBeGreaterThanOrEqual(500);
      expect(c.liq_bonus_bps, r.id).toBeLessThanOrEqual(800);
      expect(c.ltv_bps).toBeLessThanOrEqual(c.liq_threshold_bps);
      expect((c.liq_threshold_bps * (10_000 + c.liq_bonus_bps)) / 1e8).toBeLessThan(1);
      if (r.offPeg) expect(c.collateral_enabled, r.id).toBe(false);
    }
    expect(lendingAssetById("USDC")!.config.liq_bonus_bps).toBe(500);
    expect(lendingAssetById("USDC")!.config.ltv_bps).toBe(8000);
    expect(lendingAssetById("XLM")!.config.liq_threshold_bps).toBe(7500);
    expect(LENDING.poolConfig.closeFactorBps).toBe(5000);
    expect(LENDING.reserves.find((r) => r.id === "QUSD")).toBeUndefined();
  });
});

describe("rate math mirrors the contract", () => {
  const c = { base_rate_bps: 0, slope1_bps: 400, optimal_util_bps: 9000, slope2_bps: 6000, reserve_factor_bps: 1000 } as never;
  it("kinked borrow rate", () => {
    expect(borrowRateBps(c, 0)).toBe(0);
    expect(borrowRateBps(c, 4500)).toBe(200);
    expect(borrowRateBps(c, 9000)).toBe(400);
    expect(borrowRateBps(c, 10_000)).toBe(6400);
  });
  it("utilization and supply rate", () => {
    expect(utilizationBps(100, 0)).toBe(0);
    expect(utilizationBps(50, 50)).toBe(5000);
    expect(utilizationBps(0, 10)).toBe(10_000);
    expect(supplyRateBps(c, 9000)).toBeCloseTo(400 * 0.9 * 0.9, 6);
  });
  it("APR → APY", () => {
    expect(aprToApy(0)).toBe(0);
    expect(aprToApy(1000)).toBeGreaterThan(0.1);
    expect(aprToApy(1000)).toBeLessThan(0.106);
  });
});

describe("account math", () => {
  const usdc = pos({ sac: "U", suppliedUsd: 100 });
  const xlm = pos({ sac: "X", borrowedUsd: 50, collateral: false, ltvBps: 6500, thresholdBps: 7500 });
  it("totals, HF and limit used", () => {
    const t = totals([usdc, xlm]);
    expect(t.borrowLimitUsd).toBe(80);
    expect(t.hf).toBeCloseTo(85 / 50);
    expect(t.limitUsed).toBeCloseTo(50 / 80);
    expect(totals([usdc]).hf).toBe(Infinity);
    expect(hfTone(Infinity)).toBe("none");
    expect(hfTone(1.05)).toBe("danger");
    expect(hfTone(1.3)).toBe("warn");
    expect(hfTone(2)).toBe("safe");
    expect(hfLabel(Infinity)).toMatch(/no debt/);
  });
  it("collateral-disabled assets add threshold only when enabled for limit (off-peg rows have 0 ltv)", () => {
    const off = pos({ sac: "O", suppliedUsd: 100, collateralEnabled: false, ltvBps: 0, thresholdBps: 0 });
    expect(totals([off]).borrowLimitUsd).toBe(0);
  });
  it("applyAction previews each action", () => {
    const tmpl = { sac: "X", collateral: false, ltvBps: 6500, thresholdBps: 7500, collateralEnabled: true, supplyApy: 0, borrowApy: 0 };
    expect(totals(applyAction([usdc], "X", "borrow", 40, tmpl)).hf).toBeCloseTo(85 / 40);
    expect(totals(applyAction([usdc, xlm], "X", "repay", 999, tmpl)).debtUsd).toBe(0);
    expect(totals(applyAction([usdc], "U", "withdraw", 30, tmpl)).suppliedUsd).toBe(70);
    const s = applyAction([], "X", "supply", 10, tmpl);
    expect(s[0].collateral).toBe(true);
  });
  it("liquidation price for collateral (falls) and debt (rises)", () => {
    // debt 50 XLM-USD against 100 USDC @ thr 85%: HF=1 when debt value hits 85 → XLM x1.7
    expect(liquidationPrice([usdc, xlm], "X", 0.1)).toBeCloseTo(0.17, 6);
    const volCol = pos({ sac: "B", suppliedUsd: 100, thresholdBps: 7000 });
    const debt = pos({ sac: "U2", borrowedUsd: 35, collateral: false });
    // 100/p units * x * 0.7 = 35 → x = p/2
    expect(liquidationPrice([volCol, debt], "B", 60_000)).toBeCloseTo(30_000, 3);
    expect(liquidationPrice([usdc], "U", 1)).toBeNull();
  });
  it("error texts", () => {
    expect(errorText(900)).toMatch(/paused/i);
    expect(errorText(12345)).toBe("contract error #12345");
  });
});

describe("SEP-11 Txrep preview", () => {
  it("renders the contract call with CODE:ISSUER labels and the fee", () => {
    const kp = Keypair.random();
    const usdc = lendingAssetById("USDC")!;
    const tx = new TransactionBuilder(new Account(kp.publicKey(), "41"), { fee: "12345", networkPassphrase: Networks.TESTNET })
      .addOperation(new Contract(LENDING.pool).call("supply", addrv(kp.publicKey()), addrv(usdc.sac), i128v(300_000_000n)))
      .setTimeout(60).build();
    const lines = txrep(tx, [null, null, "30 USDC"]);
    const text = lines.join("\n");
    expect(text).toContain(`tx.sourceAccount: ${kp.publicKey()}`);
    expect(text).toContain("tx.fee: 12345");
    expect(text).toContain("tx.seqNum: 42");
    expect(text).toContain('functionName: "supply"');
    expect(text).toContain("Quasaria lending pool");
    expect(text).toContain(`args[1]: ${usdc.sac}  (${usdc.testnetCanonical}`);
    expect(text).toContain("args[2]: 300000000  (30 USDC)");
    expect(labelFor(usdc.sac)).toContain(usdc.testnetCanonical);
    expect(labelFor(kp.publicKey())).toBeNull();
  });
});

describe("anchor (SEP-1 / SEP-10 / SEP-38)", () => {
  const server = Keypair.random();
  const client = Keypair.random();
  const toml = parseStellarToml(`# comment
NETWORK_PASSPHRASE="${Networks.TESTNET}"
SIGNING_KEY="${server.publicKey()}"
WEB_AUTH_ENDPOINT="https://a.test/auth"
TRANSFER_SERVER_SEP0024="https://a.test/sep24"
[DOCUMENTATION]
ORG_NAME="x"
[[CURRENCIES]]
code="USDC"
issuer="GABC"
[[CURRENCIES]]
code="SRT"
`);
  const challenge = (opts: { domain?: string; seq?: string; source?: string } = {}) =>
    new TransactionBuilder(new Account(server.publicKey(), opts.seq ?? "-1"), { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.manageData({ name: `${opts.domain ?? TEST_ANCHOR_DOMAIN} auth`, value: "x".repeat(48), source: opts.source ?? client.publicKey() }))
      .setTimeout(300).build();
  it("parses stellar.toml", () => {
    expect(toml.SIGNING_KEY).toBe(server.publicKey());
    expect(toml.TRANSFER_SERVER_SEP0024).toBe("https://a.test/sep24");
    expect(toml.currencies.map((c) => c.code)).toEqual(["USDC", "SRT"]);
  });
  it("verifies SEP-10 challenges and rejects bad ones", () => {
    const ok = challenge(); ok.sign(server);
    expect(() => verifyChallenge(ok.toXDR(), client.publicKey(), toml)).not.toThrow();
    expect(() => verifyChallenge(challenge({ seq: "5" }).toXDR(), client.publicKey(), toml)).toThrow(/sequence/);
    expect(() => verifyChallenge(challenge({ domain: "evil.test" }).toXDR(), client.publicKey(), toml)).toThrow(/operation/);
    expect(() => verifyChallenge(challenge().toXDR(), Keypair.random().publicKey(), toml)).toThrow(/operation/);
    expect(() => verifyChallenge(ok.toXDR(), client.publicKey(), { ...toml, SIGNING_KEY: Keypair.random().publicKey() })).toThrow(/SIGNING_KEY/);
    expect(() => verifyChallenge(ok.toXDR(), client.publicKey(), toml, TEST_ANCHOR_DOMAIN, Date.now() / 1000 + 3600)).toThrow(/expired/);
  });
  it("gets a SEP-10 token with a wallet signature (mock fetch)", async () => {
    const ch = challenge(); ch.sign(server);
    const calls: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (!init) return new Response(JSON.stringify({ transaction: ch.toXDR() }));
      const body = JSON.parse(String(init.body));
      expect(body.transaction).toContain("SIGNED");
      return new Response(JSON.stringify({ token: "jwt" }));
    }) as typeof fetch;
    const tok = await sep10Token(toml, client.publicKey(), async (x) => `${x}SIGNED`, f);
    expect(tok).toBe("jwt");
    expect(calls[0]).toBe(`GET https://a.test/auth?account=${client.publicKey()}`);
  });
  it("SEP-38 is skipped when the anchor has no quote server, and degrades on errors", async () => {
    expect(await sep38Indicative(toml, 10)).toBeNull();
    const bad = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    expect(await sep38Indicative({ ...toml, ANCHOR_QUOTE_SERVER: "https://a.test/sep38" }, 10, bad)).toBeNull();
    const good = (async () => new Response(JSON.stringify({ buy_assets: [{ asset: "stellar:USDC:G", price: "1.02" }] }))) as unknown as typeof fetch;
    expect(await sep38Indicative({ ...toml, ANCHOR_QUOTE_SERVER: "https://a.test/sep38" }, 10, good)).toEqual([{ asset: "stellar:USDC:G", price: "1.02" }]);
  });
});

describe("quest hook", () => {
  it("a lend supply completes the one-time lending quest", () => {
    expect(questForTx("Lend supply")).toBe("first-lend");
    expect(questForTx("Lend borrow")).toBeNull();
  });
});
