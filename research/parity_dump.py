# dump last N days (+warmup) of cached candles as JSON for the TS parity harness
import sys, json; sys.path.insert(0, ".")
from data import load, aggregate
days = int(sys.argv[1]); out = {}
m1 = load(60); end = int(m1.t.iloc[-1]) + 60; start = end - days * 86400
out["start"] = start; out["end"] = end
for g, df in [(60, m1), (300, load(300)), (900, load(900))]:
    df = df[(df.t >= start - 300 * g) & (df.t + g <= end)]
    out[str(g)] = df[["t", "o", "h", "l", "c"]].to_dict("records")
json.dump(out, open("/tmp/parity_bars.json", "w"))
print(start, end, {k: len(v) for k, v in out.items() if k not in ("start", "end")})
