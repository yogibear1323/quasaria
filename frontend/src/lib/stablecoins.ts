/**
 * Verified stablecoins and tokenized treasuries on Stellar mainnet.
 * Curated allowlist, checked 2026-10-25: each issuer account's home_domain on Horizon is the issuer's own
 * official domain and that domain's stellar.toml lists this exact CODE + ISSUER (Circle: issuer home_domain
 * circle.com, addresses as published in Circle's developer docs). Lookalike/same-code issuers are excluded on purpose.
 */
export type VerifiedKind = "Stablecoin" | "Treasury";
export type VerifiedAsset = { code: string; issuer: string; name: string; org: string; domain: string; peg: string; kind: VerifiedKind };

export const VERIFIED_STABLE_AS_OF = "2026-10-25";

export const VERIFIED_ASSETS: VerifiedAsset[] = [
  { kind: "Stablecoin", code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", name: "USD Coin", org: "Circle", domain: "circle.com", peg: "USD" },
  { kind: "Stablecoin", code: "EURC", issuer: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2", name: "Euro Coin", org: "Circle", domain: "circle.com", peg: "EUR" },
  { kind: "Stablecoin", code: "PYUSD", issuer: "GDQE7IXJ4HUHV6RQHIUPRJSEZE4DRS5WY577O2FY6YQ5LVWZ7JZTU2V5", name: "PayPal USD", org: "Paxos", domain: "token-metadata.paxos.com", peg: "USD" },
  { kind: "Stablecoin", code: "USDGLO", issuer: "GBBS25EGYQPGEZCGCFBKG4OAGFXU6DSOQBGTHELLJT3HZXZJ34HWS6XV", name: "Glo Dollar", org: "Glo Foundation", domain: "app.glodollar.org", peg: "USD" },
  { kind: "Stablecoin", code: "ZUSD", issuer: "GDF6VOEGRWLOZ64PQQGKD2IYWA22RLT37GJKS2EJXZHT2VLAGWLC5TOB", name: "ZUSD", org: "GMO-Z.com Trust", domain: "stablecoin.z.com", peg: "USD" },
  { kind: "Stablecoin", code: "GYEN", issuer: "GDF6VOEGRWLOZ64PQQGKD2IYWA22RLT37GJKS2EJXZHT2VLAGWLC5TOB", name: "GYEN", org: "GMO-Z.com Trust", domain: "stablecoin.z.com", peg: "JPY" },
  { kind: "Stablecoin", code: "AUDD", issuer: "GDC7X2MXTYSAKUUGAIQ7J7RPEIM7GXSAIWFYWWH4GLNFECQVJJLB2EEU", name: "AUDD", org: "AUDD", domain: "audd.digital", peg: "AUD" },
  { kind: "Stablecoin", code: "EURC", issuer: "GAQRF3UGHBT6JYQZ7YSUYCIYWAF4T2SAA5237Q5LIQYJOHHFAWDXZ7NM", name: "EURo Coin", org: "Mykobo", domain: "mykobo.co", peg: "EUR" },
  { kind: "Stablecoin", code: "ARST", issuer: "GCSAZVWXZKWS4XS223M5F54H2B6XPIIXZZGP7KEAIU6YSL5HDRGCI3DG", name: "ARST", org: "Anclap", domain: "pubnet-sep.latamex.com", peg: "ARS" },
  { kind: "Stablecoin", code: "NGNC", issuer: "GASBV6W7GGED66MXEVC7YZHTWWYMSVYEY35USF2HJZBLABLYIFQGXZY6", name: "NGN Coin", org: "Link", domain: "ngnc.online", peg: "NGN" },
  { kind: "Treasury", code: "USTRY", issuer: "GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC", name: "Etherfuse USTRY (US Treasuries)", org: "Etherfuse", domain: "etherfuse.com", peg: "US T-bills" },
  { kind: "Treasury", code: "CETES", issuer: "GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC", name: "Etherfuse CETES (Mexican govt bonds)", org: "Etherfuse", domain: "etherfuse.com", peg: "MXN govt bonds" },
  { kind: "Treasury", code: "TESOURO", issuer: "GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC", name: "Etherfuse TESOURO (Brazilian govt bonds)", org: "Etherfuse", domain: "etherfuse.com", peg: "BRL govt bonds" },
  { kind: "Treasury", code: "BENJI", issuer: "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5", name: "Franklin OnChain U.S. Government Money Fund (FOBXX)", org: "Franklin Templeton", domain: "www.franklintempleton.com", peg: "US govt MMF" },
  { kind: "Treasury", code: "USDY", issuer: "GAJMPX5NBOG6TQFPQGRABJEEB2YE7RFRLUKJDZAZGAD5GFX4J7TADAZ6", name: "Ondo US Dollar Yield", org: "Ondo Finance", domain: "ondo.finance", peg: "US Treasuries" },
];

export type VerifiedStats = { trustlines: number; amount: string; pools: number };

export async function fetchVerifiedStats(a: VerifiedAsset, horizon = "https://horizon.stellar.org", f: typeof fetch = fetch): Promise<VerifiedStats | null> {
  const r = await f(`${horizon}/assets?asset_code=${a.code}&asset_issuer=${a.issuer}`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Horizon /assets ${r.status}`);
  const rec = (await r.json())?._embedded?.records?.[0];
  if (!rec) return null;
  return { trustlines: rec.accounts?.authorized ?? 0, amount: rec.balances?.authorized ?? rec.amount ?? "0", pools: rec.num_liquidity_pools ?? 0 };
}
