import numpy as np, pandas as pd, json, os
D = os.path.join(os.path.dirname(__file__), "..", "data")

def load(gran):
    df = pd.read_csv(os.path.join(D, f"coinbase_XLM-USD_{gran}.csv")).drop_duplicates("t").sort_values("t")
    full = pd.DataFrame({"t": np.arange(df.t.iloc[0], df.t.iloc[-1] + 1, gran)})
    df = full.merge(df, on="t", how="left")
    df["c"] = df["c"].ffill()
    for k in "ohl": df[k] = df[k].fillna(df["c"])
    df["v"] = df["v"].fillna(0)
    return df

def aggregate(df, gran, k):
    size = gran * k
    g = df.assign(b=df.t // size * size).groupby("b")
    out = pd.DataFrame({"t": g.t.first().index, "o": g.o.first().values, "h": g.h.max().values, "l": g.l.min().values, "c": g.c.last().values, "v": g.v.sum().values, "n": g.t.count().values})
    return out[out.n == k].drop(columns="n").reset_index(drop=True)

def bars(df):
    return {k: df[k].to_numpy(np.float64) if k != "t" else df[k].to_numpy(np.int64) for k in ["t", "o", "h", "l", "c", "v"] if k in df}

def series(tf):
    """bars at timeframe tf (sec)."""
    if tf in (60, 300, 900, 3600): return load(tf)
    if tf == 1800: return aggregate(load(900), 900, 2)
    if tf == 14400: return aggregate(load(3600), 3600, 4)
    raise ValueError(tf)

def funding_hourly(t):
    """Kraken Futures PF_XLMUSD hourly relative funding (fraction/h), capped at the vault's 0.05 %/h, aligned to bar times (0 before history)."""
    d = json.load(open(os.path.join(D, "kraken_PF_XLMUSD_funding.json")))["rates"]
    ts = np.array([pd.Timestamp(x["timestamp"]).timestamp() for x in d]); r = np.array([x["relativeFundingRate"] for x in d])
    idx = np.searchsorted(ts, t, side="right") - 1
    out = np.where(idx >= 0, r[np.clip(idx, 0, None)], 0.0)
    return np.clip(out, -0.0005, 0.0005)
