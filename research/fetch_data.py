"""Fetch public XLM-USD candles from Coinbase Exchange (no auth) and cache as CSV under ../data.
usage: python fetch_data.py <granularity_sec> <days>"""
import sys, time, json, urllib.request, csv, os, datetime as dt
gran, days = int(sys.argv[1]), float(sys.argv[2])
out = os.path.join(os.path.dirname(__file__), "..", "data", f"coinbase_XLM-USD_{gran}.csv")
now = int(time.time()) // gran * gran
start = now - int(days * 86400)
rows = {}
s = start
while s < now:
    e = min(now, s + gran * 300)
    url = f"https://api.exchange.coinbase.com/products/XLM-USD/candles?granularity={gran}&start={dt.datetime.utcfromtimestamp(s).isoformat()}Z&end={dt.datetime.utcfromtimestamp(e).isoformat()}Z"
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers={"user-agent": "quasaria-strat-research"})
            data = json.load(urllib.request.urlopen(req, timeout=20)); break
        except Exception as ex:
            time.sleep(1 + k)
    else:
        print("FAILED", url, file=sys.stderr); data = []
    for r in data: rows[r[0]] = r
    s = e
    time.sleep(0.35)
with open(out, "w", newline="") as f:
    w = csv.writer(f); w.writerow(["t", "o", "h", "l", "c", "v"])
    for t in sorted(rows):
        r = rows[t]; w.writerow([t, r[3], r[2], r[1], r[4], r[5]])
print(gran, len(rows), "bars ->", out)
