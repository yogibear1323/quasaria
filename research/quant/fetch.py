"""Fetch/extend Coinbase XLM-USD candles (public API) and Kraken PF_XLMUSD funding into data/ (cache, not committed)."""
import json, os, sys, time, urllib.request
import pandas as pd
D = os.path.join(os.path.dirname(__file__), "..", "..", "data")

def get(url):
    for k in range(6):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "quasaria-research"}), timeout=20)
            return json.load(r)
        except Exception as e:
            time.sleep(1 + k)
    raise RuntimeError(url)

def candles(gran, start, end, path):
    old = pd.read_csv(path) if os.path.exists(path) else pd.DataFrame(columns=list("tohlcv"))
    have = set(old.t.astype(int)) if len(old) else set()
    rows = []
    s = start
    while s < end:
        e = min(end, s + gran * 300)
        if not all(t in have for t in range(s - s % gran, e - gran, gran)):
            j = get(f"https://api.exchange.coinbase.com/products/XLM-USD/candles?granularity={gran}&start={pd.Timestamp(s, unit='s').isoformat()}Z&end={pd.Timestamp(e, unit='s').isoformat()}Z")
            rows += [dict(t=int(r[0]), o=r[3], h=r[2], l=r[1], c=r[4], v=r[5]) for r in j]
            time.sleep(0.25)
        s = e
    df = pd.concat([old, pd.DataFrame(rows)]).drop_duplicates("t", keep="last").sort_values("t")
    df.to_csv(path, index=False)
    print(gran, len(df), pd.Timestamp(df.t.min(), unit="s"), pd.Timestamp(df.t.max(), unit="s"))

if __name__ == "__main__":
    now = int(time.time())
    candles(3600, int(pd.Timestamp("2022-01-01").timestamp()), now, os.path.join(D, "coinbase_XLM-USD_3600.csv"))
    candles(900, now - 731 * 86400, now, os.path.join(D, "coinbase_XLM-USD_900.csv"))
    f = get("https://futures.kraken.com/derivatives/api/v4/historicalfundingrates?symbol=PF_XLMUSD")
    json.dump(f, open(os.path.join(D, "kraken_PF_XLMUSD_funding.json"), "w"))
    print("funding", len(f["rates"]), f["rates"][0]["timestamp"], f["rates"][-1]["timestamp"])
