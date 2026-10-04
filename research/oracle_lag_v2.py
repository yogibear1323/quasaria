"""Re-run of the stale-oracle arbitrage simulation against the NEW testnet parameters, on second-level data
(Coinbase XLM-USD public trades, last ~N hours). Oracle = market price captured at fetch time and landing `lat` s later.
Old: full push every 300 s (+~15 s fetch/tx), vault max age 900 s. New: XLM push every 20 s (+~6 s), max age 90 s.
Arbitrage rule (an attacker, NOT a strategy): when |market - oracle| > thr, open at the oracle price (fee 10 bps + slippage
5 bps each way) and close at the next oracle update. Also: feed-outage case, attacker can open until the price ages out."""
import json, time, urllib.request, numpy as np, pandas as pd, sys
H = float(sys.argv[1]) if len(sys.argv) > 1 else 8
def get(url):
    for k in range(5):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "quasaria-research"}), timeout=20)
            return json.load(r), r.headers
        except Exception: time.sleep(1 + k)
    raise RuntimeError(url)
rows = []; after = None; since = time.time() - H * 3600
for page in range(400):
    j, h = get("https://api.exchange.coinbase.com/products/XLM-USD/trades?limit=1000" + (f"&after={after}" if after else ""))
    rows += [(pd.Timestamp(x["time"]).timestamp(), float(x["price"])) for x in j]
    after = h.get("cb-after")
    if not j or rows[-1][0] < since or not after: break
    time.sleep(0.2)
df = pd.DataFrame(rows, columns=["t", "p"]).sort_values("t"); df = df[df.t >= since]
t0, t1 = int(df.t.iloc[0]) + 1, int(df.t.iloc[-1])
sec = np.arange(t0, t1); idx = np.searchsorted(df.t.values, sec, side="right") - 1; px = df.p.values[idx]
n = len(px); hours = n / 3600
def scenario(U, lat, thr):
    # oracle value at second s = market price at the last fetch time (k*U), visible from k*U + lat
    k = (np.arange(n) - lat) // U; fetch = np.clip(k * U, 0, n - 1); orc = px[fetch]
    dev = px / orc - 1; first = {}
    for i in np.nonzero(np.abs(dev) > thr / 100)[0]:
        if k[i] < 0: continue
        if k[i] not in first: first[k[i]] = i
    if not first: return dict(trades=0)
    ii = np.array(list(first.values())); s = np.sign(dev[ii]); nxt = np.minimum((k[ii] + 1) * U + lat, n - 1)
    ret = s * (orc[nxt] / orc[ii] - 1) - 0.002
    return dict(trades=len(ii), trades_per_day=round(len(ii) / hours * 24, 1), win=round(float((ret > 0).mean()), 3), avg_net_bps=round(float(ret.mean() * 1e4), 2), sum_net_pct_per_day=round(float(ret.sum() * 100 / hours * 24), 2))
out = []
for name, U, lat in [("OLD feed (300 s push, 900 s max age)", 300, 15), ("NEW feed (20 s XLM push)", 20, 6), ("option: 10 s XLM push", 10, 6)]:
    for thr in (0.1, 0.25, 0.5):
        out.append(dict(setup=name, thr_pct=thr, **scenario(U, lat, thr)))
# outage: pushes stop at a random time; attacker may open while age <= max_age, closes when the feed resumes
rng = np.random.default_rng(1)
for max_age in (900, 90):
    for O in (120, 600):
        res = []
        for _ in range(3000):
            T = rng.integers(0, n - O - 1); orc = px[T]
            w = px[T:T + min(max_age, O)] / orc - 1
            j = np.nonzero(np.abs(w) > 0.0025)[0]
            if len(j): res.append(np.sign(w[j[0]]) * (px[T + O] / orc - 1) - 0.002)
        res = np.array(res)
        out.append(dict(setup=f"feed outage {O}s, vault max age {max_age}s", thr_pct=0.25, trades=len(res), win=round(float((res > 0).mean()), 3) if len(res) else None,
                        avg_net_bps=round(float(res.mean() * 1e4), 2) if len(res) else None, note=f"opportunities per 3000 outages"))
r = pd.DataFrame(out); r.to_csv("results/oracle_lag_v2.csv", index=False)
print(f"{hours:.1f} h of trades ({len(df)} prints)"); print(r.to_string())
