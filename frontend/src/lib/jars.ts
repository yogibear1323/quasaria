/**
 * Savings Jars: a client-side organizer on top of the user's Yield Vault shares.
 * Nothing here is on-chain: jar names, targets and share allocations live in this browser's
 * localStorage, per wallet address. The vault only knows the wallet's total shares.
 * All amounts are bigint stroops / share units (7 decimals), stored as strings.
 */
export const SCALE = 10_000_000n;

export type Jar = { id: string; name: string; target: string; date?: string; shares: string; principal: string; created: number };

const key = (address: string) => `quasaria.jars.v1.${address}`;

export function loadJars(address: string, store: Pick<Storage, "getItem"> = localStorage): Jar[] {
  try {
    const v = JSON.parse(store.getItem(key(address)) ?? "[]");
    return Array.isArray(v) ? v.filter((j) => j && typeof j.id === "string" && typeof j.name === "string") : [];
  } catch { return []; }
}
export function saveJars(address: string, jars: Jar[], store: Pick<Storage, "setItem"> = localStorage) {
  store.setItem(key(address), JSON.stringify(jars));
}

export function newJar(name: string, targetStroops: bigint, date?: string, now = Date.now()): Jar {
  if (!name.trim()) throw new Error("Give the jar a name");
  if (targetStroops <= 0n) throw new Error("Target must be above 0");
  return { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim().slice(0, 40), target: targetStroops.toString(), date: date || undefined, shares: "0", principal: "0", created: now };
}

/** XLM value (stroops) of `shares` at `price` (XLM stroops per 1e7 shares). */
export const valueOf = (shares: bigint, price: bigint) => (shares * price) / SCALE;

/** Record a confirmed deposit: add the minted shares and the XLM put in. */
export const addDeposit = (j: Jar, xlm: bigint, shares: bigint): Jar => ({ ...j, shares: (BigInt(j.shares) + shares).toString(), principal: (BigInt(j.principal) + xlm).toString() });

/** Record a confirmed withdrawal of `shares`; principal is reduced pro rata. */
export function removeShares(j: Jar, shares: bigint): Jar {
  const s = BigInt(j.shares); if (shares <= 0n || shares > s) throw new Error("Not that many shares in this jar");
  const p = BigInt(j.principal);
  return { ...j, shares: (s - shares).toString(), principal: (p - (p * shares) / s).toString() };
}

/** Sum of shares across jars. */
export const allocated = (jars: Jar[]) => jars.reduce((a, j) => a + BigInt(j.shares), 0n);

/**
 * If the wallet's real vault balance is below what jars claim (e.g. a withdraw from the standalone card),
 * scale every jar down proportionally so jars never show more than the wallet owns.
 */
export function reconcile(jars: Jar[], vaultShares: bigint): Jar[] {
  const tot = allocated(jars);
  if (tot <= vaultShares || tot === 0n) return jars;
  return jars.map((j) => {
    const s = BigInt(j.shares), ns = (s * vaultShares) / tot, p = BigInt(j.principal);
    return { ...j, shares: ns.toString(), principal: s === 0n ? "0" : ((p * ns) / s).toString() };
  });
}

export type JarStats = { value: bigint; interest: bigint; pct: number; done: boolean; eta: string; perWeekNeeded: bigint | null };

/** Progress, interest and an ETA. With 0% yield the ETA comes from the jar's own deposit pace. */
export function jarStats(j: Jar, price: bigint, now = Date.now()): JarStats {
  const value = valueOf(BigInt(j.shares), price), target = BigInt(j.target);
  const interest = value - BigInt(j.principal);
  const pct = target > 0n ? Math.min(100, Number((value * 10000n) / target) / 100) : 0;
  const done = value >= target, left = target - value;
  let perWeekNeeded: bigint | null = null, eta: string;
  if (done) eta = "Goal reached";
  else {
    if (j.date) {
      const weeks = (Date.parse(j.date) - now) / (7 * 864e5);
      perWeekNeeded = weeks > 0 ? BigInt(Math.ceil(Number(left) / Math.max(weeks, 1 / 7))) : left;
    }
    const days = (now - j.created) / 864e5, principal = BigInt(j.principal);
    if (principal <= 0n || days < 1 / 24) eta = "Deposit to see an ETA";
    else {
      const perDay = Number(principal) / Math.max(days, 1);
      const etaDays = Math.ceil(Number(left) / perDay);
      eta = `~${etaDays} day${etaDays === 1 ? "" : "s"} at your deposit pace`;
    }
  }
  return { value, interest, pct, done, eta, perWeekNeeded };
}
