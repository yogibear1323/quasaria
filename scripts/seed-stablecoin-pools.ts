// TESTNET ONLY. Create + seed XLM/stablecoin pools for the auto-generated pair
// list (docs/stablecoin-pairs.json, see shared/stablecoins.ts):
//   - real testnet stablecoins where the stellarchain testnet feed lists a
//     known testnet issuer (Circle's testnet USDC / EURC), bought on the SDEX;
//   - otherwise a clearly-labelled MOCK (code "mk<CODE>", issuer home_domain
//     mock-stables.quasaria.invalid, not redeemable, no value).
// For each pair: Soroban AMM pool (+SAC) with liquidity, a native protocol
// liquidity pool deposit, and (mocks) a two-sided SDEX book.
// Keys are read from the stellar CLI keystore in-process and never printed.
// Usage: scripts/seed-stablecoin-pools.sh  (idempotent; re-run to resume)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Asset, BASE_FEE, getLiquidityPoolId, Horizon, Keypair, LiquidityPoolAsset, Networks, Operation, TransactionBuilder } from "../frontend/node_modules/@stellar/stellar-sdk/lib/esm/index.js";
import { fetchFeed } from "../shared/stablecoins.ts";

const NETWORK = "testnet";
if (process.env.NETWORK && process.env.NETWORK !== "testnet") throw new Error("TESTNET ONLY");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WASM = resolve(root, "contracts/target/wasm32v1-none/release/quasaria_amm_pool.wasm");
const OUT = resolve(root, "deployments/testnet-stablecoins.json");
const FRONT = resolve(root, "frontend/src/config/testnet-stablecoins.json");
const dep = JSON.parse(readFileSync(resolve(root, "deployments/testnet.json"), "utf8"));
const pairsDoc = JSON.parse(readFileSync(resolve(root, "docs/stablecoin-pairs.json"), "utf8"));
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const MOCK_DOMAIN = "mock-stables.quasaria.invalid";
const SOROBAN_XLM = Number(process.env.SOROBAN_XLM ?? 500);
const NATIVE_XLM = Number(process.env.NATIVE_XLM ?? 300);
const OFFER_XLM = 100;
const REAL_BUY_XLM = Number(process.env.REAL_BUY_XLM ?? 1000);

/** Known Circle testnet issuers (developers.circle.com); must also appear in the stellarchain testnet feed. */
const KNOWN_TESTNET_ISSUERS: Record<string, { issuer: string; note: string }> = {
  USDC: { issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", note: "Circle testnet USDC" },
  EURC: { issuer: "GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO", note: "Circle testnet EURC" },
};

const sh = (args: string[], quiet = false) => execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", quiet ? "ignore" : "pipe"] }).trim();
const secretOf = (id: string) => execFileSync("stellar", ["keys", "show", id], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const ensureIdentity = (id: string) => {
  try {
    return sh(["keys", "address", id], true);
  } catch {
    sh(["keys", "generate", id, "--network", NETWORK, "--fund"], true);
    return sh(["keys", "address", id], true);
  }
};
const f7 = (n: number) => (Math.floor(n * 1e7) / 1e7).toFixed(7);
const raw = (n: number) => String(BigInt(Math.floor(n * 1e7)));
const log = (...a: unknown[]) => console.log(...a);

async function submit(kp: Keypair, ops: ReturnType<typeof Operation.payment>[], memo?: string) {
  const acct = await horizon.loadAccount(kp.publicKey());
  const b = new TransactionBuilder(acct, { fee: String(Number(BASE_FEE) * 10), networkPassphrase: Networks.TESTNET });
  ops.forEach((o) => b.addOperation(o));
  const tx = b.setTimeout(120).build();
  tx.sign(kp);
  try {
    return await horizon.submitTransaction(tx);
  } catch (e) {
    const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } }).response?.data?.extras?.result_codes;
    throw new Error(`${memo ?? "tx"} failed: ${JSON.stringify(codes ?? (e as Error).message)}`);
  }
}

const state = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { pools: [] as Record<string, unknown>[] };
const save = () => {
  const doc = { network: NETWORK, generatedFrom: "docs/stablecoin-pairs.json", pairsAsOf: pairsDoc.asOf, updatedAt: new Date().toISOString(), ...state };
  writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n");
  writeFileSync(FRONT, JSON.stringify(doc, null, 2) + "\n");
};

// ---------------------------------------------------------------- plan
const primaries = (pairsDoc.pairs as { code: string; issuer: string; domain: string; peg: string; holders: number; verified: boolean; primary: boolean; mainnet: { nativePool: null | { reserveXlm: number; reserveStable: number }; sdex: null | { bestBid: number | null; bestAsk: number | null } } }[]).filter((p) => p.verified && p.primary);
log(`plan: ${primaries.length} verified primary stablecoins from docs/stablecoin-pairs.json (as of ${pairsDoc.asOf})`);
const testnetFeed = await fetchFeed({ network: "testnet", itemsPerPage: 100, maxPages: 3 }, fetch as never);
const feedHas = (code: string, issuer: string) => testnetFeed.some((a) => a.code === code && a.issuer === issuer);

/** Stable units per 1 XLM from the mainnet snapshot. */
function pxOf(p: (typeof primaries)[number]) {
  const s = p.mainnet?.sdex;
  if (s?.bestBid && s.bestAsk && (s.bestAsk - s.bestBid) / ((s.bestAsk + s.bestBid) / 2) < 0.1) return (s.bestBid + s.bestAsk) / 2;
  const n = p.mainnet?.nativePool;
  if (n && n.reserveXlm > 0) return n.reserveStable / n.reserveXlm;
  return 0.22; // ~USD fallback
}

const ADMIN = dep.admin as string;
const adminKp = Keypair.fromSecret(secretOf("quasaria-admin"));
if (adminKp.publicKey() !== ADMIN) throw new Error("admin identity mismatch");
const mockAddr = ensureIdentity("quasaria-mock-stables");
const mockKp = Keypair.fromSecret(secretOf("quasaria-mock-stables"));
state.mockIssuer = mockAddr;
state.mockHomeDomain = MOCK_DOMAIN;

// ---------------------------------------------------------------- XLM budget (friendbot → merge into admin)
const need = primaries.length * (SOROBAN_XLM + NATIVE_XLM + OFFER_XLM + 10) + 2 * REAL_BUY_XLM + 500;
const bal = async (a: string) => Number((await horizon.loadAccount(a)).balances.find((b) => b.asset_type === "native")!.balance);
let have = await bal(ADMIN);
for (let i = 1; have < need && i <= 6; i++) {
  const id = `quasaria-funder-${Date.now()}-${i}`;
  const addr = ensureIdentity(id);
  const kp = Keypair.fromSecret(secretOf(id));
  await submit(kp, [Operation.accountMerge({ destination: ADMIN })], "merge funder");
  try { sh(["keys", "rm", id], true); } catch { /* ignore */ }
  have = await bal(ADMIN);
  log(`  merged friendbot funder ${addr.slice(0, 6)}… → admin now ${have.toFixed(0)} XLM`);
}

// mock issuer home domain label
const mockAcct = await horizon.loadAccount(mockAddr);
if ((mockAcct as unknown as { home_domain?: string }).home_domain !== MOCK_DOMAIN) await submit(mockKp, [Operation.setOptions({ homeDomain: MOCK_DOMAIN })], "set mock home_domain");

// ---------------------------------------------------------------- real testnet stablecoins: acquire on the SDEX
// Circle's testnet issuers are only used if the stellarchain testnet feed lists them AND we can actually
// buy enough on the testnet SDEX (Circle's faucet is a manual web form). Otherwise fall back to a mock.
state.realUnavailable = state.realUnavailable ?? {};
{
  const acct = await horizon.loadAccount(ADMIN);
  for (const p of primaries) {
    const known = KNOWN_TESTNET_ISSUERS[p.code];
    if (!known || state.realUnavailable[p.code]) continue;
    if (!feedHas(p.code, known.issuer)) { state.realUnavailable[p.code] = "not listed in the stellarchain testnet feed"; continue; }
    const a = new Asset(p.code, known.issuer);
    const needStable = (SOROBAN_XLM + NATIVE_XLM) * pxOf(p);
    const cur = () => horizon.loadAccount(ADMIN).then((x) => Number(x.balances.find((b) => "asset_code" in b && b.asset_code === p.code && b.asset_issuer === known.issuer)?.balance ?? 0));
    if (!acct.balances.some((b) => "asset_code" in b && b.asset_code === p.code && b.asset_issuer === known.issuer)) await submit(adminKp, [Operation.changeTrust({ asset: a })], `trust ${p.code}`);
    if ((await cur()) >= needStable) continue;
    const paths = await horizon.strictReceivePaths([Asset.native()], a, f7(needStable * 1.1)).call();
    const best = paths.records.sort((x, y) => Number(x.source_amount) - Number(y.source_amount))[0];
    if (!best || Number(best.source_amount) > REAL_BUY_XLM) {
      state.realUnavailable[p.code] = `no affordable sell-side liquidity for ${p.code} on the testnet SDEX (needed ${needStable.toFixed(2)}${best ? `, cost ${Number(best.source_amount).toFixed(0)} XLM` : ", no path"})`;
      log(`  ${p.code}: ${state.realUnavailable[p.code]} → using a MOCK`);
      continue;
    }
    await submit(adminKp, [Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: f7(Number(best.source_amount) * 1.03), destination: ADMIN, destAsset: a, destAmount: f7(needStable * 1.1), path: best.path.map((x) => (x.asset_type === "native" ? Asset.native() : new Asset(x.asset_code, x.asset_issuer))) })], `buy ${p.code}`);
    log(`  bought ${(needStable * 1.1).toFixed(4)} ${p.code} for ≤${best.source_amount} XLM on the testnet SDEX`);
  }
  save();
}

type Entry = { realNote?: string; mainnetCode: string; code: string; issuer: string; assetKey: string; mock: boolean; label: string; peg: string; mainnet: { issuer: string; domain: string; holders: number }; pxXlm: number; sac?: string; pool?: string; nativePoolId?: string; soroban?: { xlm: number; stable: number }; native?: { xlm: number; stable: number }; sdexOffers?: boolean };
const entries: Entry[] = primaries.map((p) => {
  const known = KNOWN_TESTNET_ISSUERS[p.code];
  const real = known && feedHas(p.code, known.issuer) && !state.realUnavailable[p.code];
  const prevRaw = (state.pools as Entry[]).find((e) => e.mainnetCode === p.code);
  const prev = prevRaw && prevRaw.code === (known && feedHas(p.code, known.issuer) && !state.realUnavailable[p.code] ? p.code : `mk${p.code}`.slice(0, 12)) ? prevRaw : undefined;
  const code = real ? p.code : `mk${p.code}`.slice(0, 12);
  const issuer = real ? known.issuer : mockAddr;
  return {
    ...(prev ?? {}),
    mainnetCode: p.code, code, issuer, assetKey: `${code}-${issuer}`, mock: !real,
    label: real ? `${known.note} (real testnet asset)` : `MOCK ${p.code} — Quasaria testnet mock, not redeemable, no value`,
    peg: p.peg, mainnet: { issuer: p.issuer, domain: p.domain, holders: p.holders }, pxXlm: pxOf(p),
    ...(real ? {} : { realNote: known ? state.realUnavailable[p.code] : undefined }),
  } as Entry;
});
state.pools = entries;
save();

// ---------------------------------------------------------------- trustlines + mock issuance
const adminAcct = await horizon.loadAccount(ADMIN);
const hasTl = (code: string, issuer: string) => adminAcct.balances.some((b) => "asset_code" in b && b.asset_code === code && b.asset_issuer === issuer);
const assetOf = (e: Entry) => new Asset(e.code, e.issuer);
const tlOps = entries.filter((e) => !hasTl(e.code, e.issuer)).map((e) => Operation.changeTrust({ asset: assetOf(e) }));
for (let i = 0; i < tlOps.length; i += 50) await submit(adminKp, tlOps.slice(i, i + 50), "trustlines");
if (tlOps.length) log(`  added ${tlOps.length} trustlines`);
const balOf = async (e: Entry) => Number((await horizon.loadAccount(ADMIN)).balances.find((b) => "asset_code" in b && b.asset_code === e.code && b.asset_issuer === e.issuer)?.balance ?? 0);
const mintOps: ReturnType<typeof Operation.payment>[] = [];
for (const e of entries.filter((x) => x.mock)) {
  const want = (SOROBAN_XLM + NATIVE_XLM + OFFER_XLM) * e.pxXlm * 1.2;
  const cur = await balOf(e);
  if (cur < want * 0.5) mintOps.push(Operation.payment({ destination: ADMIN, asset: assetOf(e), amount: f7(want - cur) }));
}
if (mintOps.length) {
  await submit(mockKp, mintOps, "mint mocks");
  log(`  minted ${mintOps.length} mock stablecoins to admin`);
}

// ---------------------------------------------------------------- native (protocol) liquidity pools + SDEX offers
const lpOps: ReturnType<typeof Operation.payment>[] = [];
const acct2 = await horizon.loadAccount(ADMIN);
for (const e of entries) {
  const lpAsset = new LiquidityPoolAsset(Asset.native(), assetOf(e), 30);
  e.nativePoolId = Buffer.from(getLiquidityPoolId("constant_product", { assetA: Asset.native(), assetB: assetOf(e), fee: 30 })).toString("hex");
  if (e.native) continue;
  const stableBal = await balOf(e);
  // join an existing native pool at ITS price (deposits must match the pool ratio)
  const existing = await horizon.liquidityPools().liquidityPoolId(e.nativePoolId).call().catch(() => null);
  const poolPx = existing && Number(existing.reserves[0].amount) > 0 ? Number(existing.reserves[1].amount) / Number(existing.reserves[0].amount) : e.pxXlm;
  const xlm = e.mock ? NATIVE_XLM : Math.min(NATIVE_XLM, (stableBal * 0.3) / poolPx);
  if (poolPx !== e.pxXlm) log(`  ${e.code}: joining existing native pool at its price ${poolPx.toPrecision(5)} ${e.code}/XLM`);
  const stable = xlm * poolPx;
  const hasShare = acct2.balances.some((b) => b.asset_type === "liquidity_pool_shares" && (b as { liquidity_pool_id: string }).liquidity_pool_id === e.nativePoolId);
  if (!hasShare) lpOps.push(Operation.changeTrust({ asset: lpAsset }));
  const ratio = xlm / stable; // SDK: min/max price = amountA/amountB bounds
  lpOps.push(Operation.liquidityPoolDeposit({ liquidityPoolId: e.nativePoolId, maxAmountA: f7(xlm), maxAmountB: f7(stable), minPrice: (ratio * 0.95).toPrecision(7), maxPrice: (ratio * 1.05).toPrecision(7) }));
  e.native = { xlm: Number(f7(xlm)), stable: Number(f7(stable)) };
  if (e.mock && !e.sdexOffers) {
    lpOps.push(Operation.manageSellOffer({ selling: Asset.native(), buying: assetOf(e), amount: f7(OFFER_XLM), price: (e.pxXlm / 0.99).toPrecision(7) })); // bid: pay 0.99/px XLM per unit
    lpOps.push(Operation.manageSellOffer({ selling: assetOf(e), buying: Asset.native(), amount: f7(OFFER_XLM * e.pxXlm), price: (1.01 / e.pxXlm).toPrecision(7) }));
    e.sdexOffers = true;
  }
}
for (let i = 0; i < lpOps.length; i += 60) await submit(adminKp, lpOps.slice(i, i + 60), "native LPs + offers");
if (lpOps.length) log(`  native liquidity pools + SDEX offers: ${lpOps.length} ops`);
save();

// ---------------------------------------------------------------- Soroban AMM pools
const inv = (id: string, args: string[], send = true) => sh(["contract", "invoke", "--id", id, "--source", "quasaria-admin", "--network", NETWORK, ...(send ? [] : ["--send=no"]), "--", ...args], true);
for (const e of entries) {
  if (!e.sac) {
    try {
      e.sac = sh(["contract", "asset", "deploy", "--asset", `${e.code}:${e.issuer}`, "--source", "quasaria-admin", "--network", NETWORK], true);
    } catch {
      e.sac = sh(["contract", "id", "asset", "--asset", `${e.code}:${e.issuer}`, "--network", NETWORK], true);
    }
    save();
  }
  const alias = `quasaria-stable-${e.code.toLowerCase()}`;
  if (!e.pool) {
    let existing = "";
    try { existing = sh(["contract", "alias", "show", alias, "--network", NETWORK], true); } catch { /* none */ }
    e.pool = existing || sh(["contract", "deploy", "--wasm", WASM, "--source", "quasaria-admin", "--network", NETWORK, "--alias", alias, "--", "--admin", ADMIN, "--token_a", dep.contracts.xlmSac, "--token_b", e.sac, "--fee_bps", "30", "--referral", `"${dep.contracts.referral}"`], true);
    inv(dep.contracts.referral, ["set_fee_source", "--source", e.pool, "--allowed", "true"]);
    save();
  }
  if (!e.soroban) {
    const info = JSON.parse(inv(e.pool, ["info"], false));
    if (Number(info.total_shares) === 0) {
      const stableBal = await balOf(e);
      const xlm = e.mock ? SOROBAN_XLM : Math.min(SOROBAN_XLM, (stableBal * 0.95) / e.pxXlm);
      inv(e.pool, ["deposit", "--to", ADMIN, "--desired_a", raw(xlm), "--desired_b", raw(xlm * e.pxXlm), "--min_a", "0", "--min_b", "0"]);
      e.soroban = { xlm: Number(f7(xlm)), stable: Number(f7(xlm * e.pxXlm)) };
    } else e.soroban = { xlm: Number(info.reserve_a) / 1e7, stable: Number(info.reserve_b) / 1e7 };
    save();
  }
  log(`  ✔ XLM/${e.code.padEnd(9)} ${e.mock ? "MOCK" : "REAL"} pool ${e.pool} · soroban ${e.soroban!.xlm} XLM / ${e.soroban!.stable.toFixed(4)} · native ${e.native?.xlm} / ${e.native?.stable.toFixed(4)}`);
}
save();
log(`wrote ${OUT}`);
