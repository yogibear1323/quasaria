// READ-ONLY mainnet verification of the curated Quasaria asset list.
// For each candidate (code + issuer): loads the issuer account from PUBLIC mainnet
// Horizon (home_domain), fetches https://<home_domain>/.well-known/stellar.toml and
// checks that its CURRENCIES table lists exactly this code + issuer, reads holders /
// supply, and a live price vs XLM (SDEX mid → native LP → last 1h candle).
// Nothing is signed or submitted; mainnet is only read. Output:
//   config/assets.mainnet.json   (reference list for future mainnet use)
// Usage: node scripts/verify-mainnet-assets.ts
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "../frontend/node_modules/smol-toml/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const H = "https://horizon.stellar.org";
type Cat = "stablecoin" | "popular";
type Cand = {
  code: string; issuer: string; category: Cat; peg?: string; name?: string;
  /** Official page that publishes CODE-ISSUER / the issuer address; fetched and grepped (for issuers with no reachable toml). */
  altSource?: { url: string; note: string };
  /** Official domain whose stellar.toml lists the asset when the issuer account has no home_domain set. */
  tomlDomain?: string;
};

// Issuers come from the issuers' own stellar.toml / official docs (not guessed);
// every row is re-verified below and rows that fail are reported, not written as verified.
export const CANDIDATES: Cand[] = [
  // ---- stablecoins: global brands
  { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", category: "stablecoin", peg: "USD", name: "USD Coin (Circle)",
    altSource: { url: "https://developers.circle.com/stablecoins/usdc-contract-addresses", note: "circle.com/.well-known/stellar.toml returns 404; issuer published in Circle's official USDC contract-address docs (testnet: USDC-GBBD47IF…LFLA5)." } },
  { code: "EURC", issuer: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2", category: "stablecoin", peg: "EUR", name: "Euro Coin (Circle)",
    altSource: { url: "https://developers.circle.com/stablecoins/eurc-contract-addresses", note: "circle.com/.well-known/stellar.toml returns 404; issuer published in Circle's official EURC contract-address docs (testnet: EURC-GB3Q6QDZ…M2ZTVO)." } },
  { code: "PYUSD", issuer: "GDQE7IXJ4HUHV6RQHIUPRJSEZE4DRS5WY577O2FY6YQ5LVWZ7JZTU2V5", category: "stablecoin", peg: "USD" },
  { code: "USDGLO", issuer: "GBBS25EGYQPGEZCGCFBKG4OAGFXU6DSOQBGTHELLJT3HZXZJ34HWS6XV", category: "stablecoin", peg: "USD" },
  { code: "EURCV", issuer: "GCEYGIVOLAVBF2TG2RUSGTUJCIN75KEX3NGLMY4VPL4GFE5L355AXW3G", category: "stablecoin", peg: "EUR", name: "EUR CoinVertible (SG-FORGE)",
    altSource: { url: "https://www.sgforge.com/wp-content/uploads/2025/10/EURCV-White-Paper_iXBRL_202510.html", note: "Issuer address published in SG-FORGE's MiCA white paper (Oct 2025). Beware: the most-held 'EURCV' on Stellar (GAUQKYP3…) is NOT SG-FORGE's." } },
  { code: "USDT0", issuer: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q", category: "stablecoin", peg: "USD", tomlDomain: "usdt0.to" },
  { code: "GYEN", issuer: "GDF6VOEGRWLOZ64PQQGKD2IYWA22RLT37GJKS2EJXZHT2VLAGWLC5TOB", category: "stablecoin", peg: "JPY" },
  { code: "ZUSD", issuer: "GDF6VOEGRWLOZ64PQQGKD2IYWA22RLT37GJKS2EJXZHT2VLAGWLC5TOB", category: "stablecoin", peg: "USD" },
  { code: "AUDD", issuer: "GDC7X2MXTYSAKUUGAIQ7J7RPEIM7GXSAIWFYWWH4GLNFECQVJJLB2EEU", category: "stablecoin", peg: "AUD" },
  { code: "VEUR", issuer: "GDXLSLCOPPHTWOQXLLKSVN4VN3G67WD2ENU7UMVAROEYVJLSPSEWXIZN", category: "stablecoin", peg: "EUR" },
  { code: "VCHF", issuer: "GDXLSLCOPPHTWOQXLLKSVN4VN3G67WD2ENU7UMVAROEYVJLSPSEWXIZN", category: "stablecoin", peg: "CHF" },
  { code: "USDx", issuer: "GAVH5ZWACAY2PHPUG4FL3LHHJIYIHOFPSIUGM2KHK25CJWXHAV6QKDMN", category: "stablecoin", peg: "USD" },
  { code: "USD", issuer: "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX", category: "stablecoin", peg: "USD" },
  // ---- stablecoins: regional anchors
  { code: "ARST", issuer: "GCSAZVWXZKWS4XS223M5F54H2B6XPIIXZZGP7KEAIU6YSL5HDRGCI3DG", category: "stablecoin", peg: "ARS" },
  { code: "ARS", issuer: "GCYE7C77EB5AWAA25R5XMWNI2EDOKTTFTTPZKM2SR5DI4B4WFD52DARS", category: "stablecoin", peg: "ARS" },
  { code: "BRL", issuer: "GDVKY2GU2DRXWTBEYJJWSFXIGBZV6AZNBVVSUHEPZI54LIS6BA7DVVSP", category: "stablecoin", peg: "BRL" },
  { code: "BRLT", issuer: "GCHQ3F2BF5P74DMDNOOGHT5DUCKC773AW5DTOFINC26W4KGYFPYDPRSO", category: "stablecoin", peg: "BRL" },
  { code: "BRZ", issuer: "GABMA6FPH3OJXNTGWO7PROF7I5WPQUZOB4BLTBTP4FK6QV7HWISLIEO2", category: "stablecoin", peg: "BRL" },
  { code: "MXN", issuer: "GCKIK5F6J4KMKF6MKB5EM67S5CK557EZQ3IAMZM5FFAYST63S3HWXVPE", category: "stablecoin", peg: "MXN" },
  { code: "MXNe", issuer: "GCQCNWT22JDLENQAVIE6DRJGHWAQ6EX2H5ABGPV55EJUPPZM5UA7KHZR", category: "stablecoin", peg: "MXN" },
  { code: "NGNC", issuer: "GASBV6W7GGED66MXEVC7YZHTWWYMSVYEY35USF2HJZBLABLYIFQGXZY6", category: "stablecoin", peg: "NGN" },
  { code: "NGNT", issuer: "GAWODAROMJ33V5YDFY3NPYTHVYQG7MJXVJ2ND3AOGIHYRWINES6ACCPD", category: "stablecoin", peg: "NGN" },
  { code: "NGN", issuer: "GCC4YLCR7DDWFCIPTROQM7EB2QMFD35XRWEQVIQYJQHVW6VE5MJZXIGW", category: "stablecoin", peg: "NGN" },
  { code: "PEN", issuer: "GA4TDPNUCZPTOHB3TKUYMDCRVATXKEADH7ZEYEBWJKQKE2UBFCYNBPEN", category: "stablecoin", peg: "PEN" },
  { code: "CLPX", issuer: "GDYSPBVZHPQTYMGSYNOHRZQNLB3ZWFVQ2F7EP7YBOLRGD42XIC3QUX5G", category: "stablecoin", peg: "CLP" },
  { code: "USDZ", issuer: "GAKTLPC4ZV37SSCITQ5IS5AQ4WPF4CF4VZJQPPAROSGXMYOATF5U6XPR", category: "stablecoin", peg: "USD" },
  { code: "ZARZ", issuer: "GAROH4EV3WVVTRQKEY43GZK3XSRBEYETRVZ7SVG5LHWOAANSMCTJBB3U", category: "stablecoin", peg: "ZAR" },
  { code: "KES", issuer: "GA2MSSZKJOU6RNL3EJKH3S5TB5CDYTFQFWRYFGUJVIN5I6AOIRTLUHTO", category: "stablecoin", peg: "KES" },
  { code: "IDRT", issuer: "GDPKQ2TSNJOFSEE7XSUXPWRP27H6GFGLWD7JCHNEYYWQVGFA543EVBVT", category: "stablecoin", peg: "IDR" },
  { code: "XCHF", issuer: "GDPKQ2TSNJOFSEE7XSUXPWRP27H6GFGLWD7JCHNEYYWQVGFA543EVBVT", category: "stablecoin", peg: "CHF" },
  { code: "EURMTL", issuer: "GACKTN5DAZGWXRWB2WLM6OPBDHAMT6SJNGLJZPQMEZBUR4JUGBX2UK7V", category: "stablecoin", peg: "EUR" },
  { code: "USDM", issuer: "GDHDC4GBNPMENZAOBB4NCQ25TGZPDRK6ZGWUGSI22TVFATOLRPSUUSDM", category: "stablecoin", peg: "USD" },
  // ---- popular assets
  { code: "SHX", issuer: "GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEKEBR7UCHEUUEK72N7I7KJ6JH", category: "popular" },
  { code: "AQUA", issuer: "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA", category: "popular" },
  { code: "yXLM", issuer: "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55", category: "popular" },
  { code: "yUSDC", issuer: "GDGTVWSM4MGS4T7Z6W4RPWOCHE2I6RDFCIFZGS3DOA63LWQTRNZNTTFF", category: "popular" },
  { code: "yBTC", issuer: "GBUVRNH4RW4VLHP4C5MOF46RRIRZLAVHYGX45MVSTKA2F6TMR7E7L6NW", category: "popular" },
  { code: "BTC", issuer: "GDPJALI4AZKUU2W426U5WKMAT6CN3AJRPIIRYR2YM54TL2GDWO5O2MZM", category: "popular" },
  { code: "ETH", issuer: "GBFXOHVAS43OIWNIO7XLRJAHT3BICFEIKOJLZVXNT572MISM4CMGSOCC", category: "popular" },
  { code: "VELO", issuer: "GDM4RQUQQUVSKQA7S6EM7XBZP3FCGH4Q7CL6TABQ7B2BEJ5ERARM2M5M", category: "popular", tomlDomain: "velo.org" },
  { code: "BLND", issuer: "GDJEHTBE6ZHUXSWFI642DCGLUOECLHPF3KSXHPXTSTJ7E3JF6MQ5EZYY", category: "popular", name: "Blend (BLND)",
    altSource: { url: "https://docs.blend.capital/mainnet-deployments.md", note: "Issuer has no home_domain; classic asset published in Blend's official mainnet deployment docs." } },
  { code: "XRP", issuer: "GBXRPL45NPHCVMFFAYZVUVFFVKSIZ362ZXFP7I2ETNQ3QKZMFLPRDTD5", category: "popular" },
  { code: "SCOP", issuer: "GC6OYQJIZF3HFXCYPFCBXYXNGIBQ4TNSFUBUXQJOZWIP6F3YZK4QH3VQ", category: "popular" },
  { code: "AFR", issuer: "GBX6YI45VU7WNAAKA3RBFDR3I3UKNFHTJPQ5F6KOOKSGYIAM4TRQN54W", category: "popular" },
  { code: "TFT", issuer: "GBOVQKJYHXRR3DX6NOX2RRYFRCUMSADGDESTDNBDS6CDVLGVESRTAC47", category: "popular" },
  { code: "GOLD", issuer: "GBC5ZGK6MQU3XG5Y72SXPA7P5R5NHYT2475SNEJB2U3EQ6J56QLVGOLD", category: "popular" },
  { code: "SLVR", issuer: "GBZVELEQD3WBN3R3VAG64HVBDOZ76ZL6QPLSFGKWPFED33Q3234NSLVR", category: "popular" },
  { code: "LSP", issuer: "GAB7STHVD5BDH3EEYXPI3OM7PCS4V443PYB5FNT6CFGJVPDLMKDM24WK", category: "popular" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function getJson(url: string, tries = 3): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (r.status === 404) return null;
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await sleep(800 * (i + 1));
  }
  throw new Error(`GET failed: ${url}`);
}
async function getText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "user-agent": "quasaria-asset-verifier/1.0 (read-only)" } });
    return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : "" };
  } catch (e) {
    return { ok: false, status: 0, text: String((e as Error).message) };
  }
}
const assetQs = (p: string, c: Cand) => `${p}_asset_type=${c.code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12"}&${p}_asset_code=${c.code}&${p}_asset_issuer=${c.issuer}`;

async function priceXlm(c: Cand): Promise<{ perXlm: number | null; source: string }> {
  // units of asset per 1 XLM
  const ob = await getJson(`${H}/order_book?selling_asset_type=native&${assetQs("buying", c)}&limit=1`).catch(() => null);
  const bid = ob?.bids?.[0] ? Number(ob.bids[0].price) : null, ask = ob?.asks?.[0] ? Number(ob.asks[0].price) : null;
  if (bid && ask && (ask - bid) / ((ask + bid) / 2) < 0.08) return { perXlm: (bid + ask) / 2, source: "sdex-mid" };
  const lp = await getJson(`${H}/liquidity_pools?reserves=native,${c.code}:${c.issuer}&limit=5`).catch(() => null);
  const rec = lp?._embedded?.records?.sort((a: any, b: any) => Number(b.total_shares) - Number(a.total_shares))[0];
  if (rec) {
    const x = Number(rec.reserves.find((r: any) => r.asset === "native")?.amount ?? 0), s = Number(rec.reserves.find((r: any) => r.asset !== "native")?.amount ?? 0);
    if (x > 1000) return { perXlm: s / x, source: "native-lp" };
  }
  const end = Date.now();
  const ag = await getJson(`${H}/trade_aggregations?base_asset_type=native&${assetQs("counter", c)}&resolution=3600000&start_time=${end - 7 * 86400000}&end_time=${end}&order=desc&limit=1`).catch(() => null);
  const close = ag?._embedded?.records?.[0]?.close;
  if (close) return { perXlm: Number(close), source: "last-1h-candle(7d)" };
  if (bid && ask) return { perXlm: (bid + ask) / 2, source: "sdex-mid(wide)" };
  if (bid || ask) return { perXlm: (bid ?? ask)!, source: "sdex-one-side" };
  return { perXlm: null, source: "none" };
}

const tomlCache = new Map<string, Promise<{ ok: boolean; status: number; doc: any }>>();
const loadToml = (domain: string) => {
  if (!tomlCache.has(domain))
    tomlCache.set(domain, getText(`https://${domain}/.well-known/stellar.toml`).then((r) => {
      if (!r.ok) return { ok: false, status: r.status, doc: null };
      try { return { ok: true, status: r.status, doc: parseToml(r.text) }; } catch { return { ok: false, status: -1, doc: null }; }
    }));
  return tomlCache.get(domain)!;
};

// Logo fallback: the stellarchain.io snapshot (issuer toml images collected server-side) for
// assets whose toml has no https image or is unreachable (e.g. circle.com).
import { readFileSync as _rf } from "node:fs";
const snap = JSON.parse(_rf(resolve(root, "frontend/public/data/stellarchain-snapshot.json"), "utf8"));
const snapLogo = (c: Cand): string | null => {
  const m = (snap.marketAssets?.mainnet?.member ?? []).find((x: any) => x.code === c.code && x.issuer === c.issuer);
  const u = m?.tomlInfo?.image ?? m?.imageUrl;
  return typeof u === "string" && u.startsWith("https://") ? u : null;
};
const out: any[] = [];
for (const c of CANDIDATES) {
  const acct = await getJson(`${H}/accounts/${c.issuer}`);
  const homeDomain: string | null = acct?.home_domain || null;
  const st = await getJson(`${H}/assets?asset_code=${c.code}&asset_issuer=${c.issuer}&limit=1`);
  const a = st?._embedded?.records?.[0];
  let verification = "no-home-domain", cur: any = null, org: any = null, tomlStatus: number | null = null, verifiedVia: string | null = null;
  for (const dom of [homeDomain, c.tomlDomain].filter(Boolean) as string[]) {
    const t = await loadToml(dom);
    tomlStatus = t.status;
    if (t.ok) {
      cur = (t.doc.CURRENCIES ?? []).find((x: any) => x.code === c.code && x.issuer === c.issuer) ?? null;
      org = t.doc.DOCUMENTATION ?? null;
      verification = cur ? (dom === homeDomain ? "toml-verified" : "toml-verified(domain)") : "not-listed-in-toml";
      if (cur) { verifiedVia = `https://${dom}/.well-known/stellar.toml`; break; }
    } else verification = `toml-unreachable(${t.status})`;
  }
  if (!verifiedVia && c.altSource) {
    const d = await getText(c.altSource.url);
    if (d.ok && (d.text.includes(`${c.code}-${c.issuer}`) || d.text.includes(c.issuer))) { verification = "issuer-doc-verified"; verifiedVia = c.altSource.url; }
    else verification += "+doc-check-failed";
  }
  const px = await priceXlm(c);
  const row = {
    code: c.code, issuer: c.issuer, category: c.category, peg: c.peg ?? null,
    name: c.name ?? cur?.name ?? null, org: org?.ORG_NAME ?? null, homeDomain, verification,
    verifiedVia, verified: Boolean(verifiedVia),
    note: c.altSource?.note ?? null, tomlStatus,
    logo: typeof cur?.image === "string" && cur.image.startsWith("https://") ? cur.image : snapLogo(c),
    anchorAsset: cur?.anchor_asset ?? null,
    holders: a ? (a.accounts?.authorized ?? 0) + (a.accounts?.authorized_to_maintain_liabilities ?? 0) : null,
    supply: a ? Number(a.balances?.authorized ?? a.amount ?? 0) : null,
    exists: Boolean(a), authRequired: Boolean(acct?.flags?.auth_required),
    pricePerXlm: px.perXlm, priceSource: px.source,
    expert: `https://stellar.expert/explorer/public/asset/${c.code}-${c.issuer}`,
  };
  out.push(row);
  console.log(`${verifiedVia ? "✔" : "✘"} ${c.code.padEnd(7)} ${String(homeDomain).padEnd(28)} ${verification.padEnd(22)} holders ${String(row.holders).padStart(8)}  ${px.perXlm?.toPrecision(6) ?? "—"} /XLM (${px.source})`);
  await sleep(150);
}
// Stablecoin price sanity. Reference = XLM/USD (Circle USDC SDEX mid above) × the public FX rate
// for the peg (open.er-api.com, read-only). Weak own quotes (one-sided book / none) are replaced
// by the FX reference; liquid quotes are kept (they ARE the mainnet price) but flagged "offPeg"
// when >20% away from the reference, and off-peg coins are excluded from stable-stable pairs.
const strong = (r: any) => r.pricePerXlm && ["sdex-mid", "native-lp", "last-1h-candle(7d)"].includes(r.priceSource);
const fx = await getJson("https://open.er-api.com/v6/latest/USD").catch(() => null);
const usdPerXlm = out.find((x) => x.code === "USDC")?.pricePerXlm as number | undefined;
const fxRef = (peg: string | null) => (peg && fx?.rates?.[peg] && usdPerXlm ? usdPerXlm * Number(fx.rates[peg]) : null);
for (const r of out.filter((x) => x.category === "stablecoin")) {
  const ref = fxRef(r.peg);
  if (!ref) continue;
  r.fxReferencePerXlm = Number(ref.toPrecision(8));
  if (!strong(r)) { r.priceNote = `own quote ${r.priceSource} → FX reference (${r.peg})`; r.pricePerXlm = r.fxReferencePerXlm; r.priceSource = `fx-reference:${r.peg}`; continue; }
  const dev = r.pricePerXlm / ref - 1;
  r.pegDeviation = Number(dev.toFixed(4));
  if (Math.abs(dev) > 0.2) { r.offPeg = true; r.priceNote = `mainnet price ${(dev * 100).toFixed(0)}% from the ${r.peg} FX reference — flagged off-peg; excluded from stable-stable pairs`; }
}
const doc = {
  _comment: "Curated Quasaria asset list — MAINNET reference data (codes, issuers, home domains), verified READ-ONLY against public Horizon + each issuer's stellar.toml (or the issuer's official docs where no toml is reachable) by scripts/verify-mainnet-assets.ts. Rows with verified=false are documented but NOT used. Quasaria trades on TESTNET only; this file is for display, testnet mirroring and future mainnet use. Verification proves the issuer is claimed by its official domain/docs; it is not an endorsement.",
  generatedAt: new Date().toISOString(), horizon: H, fxSource: fx ? `open.er-api.com (${fx.time_last_update_utc})` : null, usdPerXlm, assets: out,
};
writeFileSync(resolve(root, "config/assets.mainnet.json"), JSON.stringify(doc, null, 2) + "\n");
console.log(`wrote config/assets.mainnet.json (${out.length} assets, ${out.filter((r) => r.verified).length} verified)`);
for (const r of out.filter((x) => x.priceNote)) console.log(`  price: ${r.code}: ${r.priceNote}`);
