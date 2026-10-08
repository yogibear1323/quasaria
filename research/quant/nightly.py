"""Nightly review + self-improvement proposal for the calibrated desk (slow layer). Never ships by itself.

1. Review: reads the desk's calibration log (every decision + resolved outcome + paper fills) and writes a review:
   live Brier / reliability per question on the desk's OWN decisions, paper P&L, and a root-cause tag for every loss.
2. Propose: refreshes market data and re-runs the full walk-forward study and strategy gate with the latest data.
3. Ship: only with --ship AND only if the proposal clears the SAME gate (OOS Sharpe > 1.5, max DD < 15 %, hit > 55 %,
   t > 2, deflated Sharpe >= 0.95, random-entry control p < 0.05, positive holdout). Shipping = replacing the model file
   the fleet loads; the fleet must still be restarted by an operator. Otherwise the proposal is only written down.

Usage: python3 research/quant/nightly.py [--log ~/.quasaria-office/state/calibration.jsonl] [--out ~/.quasaria-office/nightly] [--ship --model-dest PATH]
"""
import argparse, json, os, shutil, subprocess, sys, time
from datetime import datetime, timezone
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import brier, QUESTIONS  # noqa


def review(log_path):
    dec, out, closes = {}, {}, []
    if os.path.exists(log_path):
        for line in open(log_path):
            try: e = json.loads(line)
            except Exception: continue
            if e.get("type") == "decision": dec[e["t"]] = e
            elif e.get("type") == "outcome": out[e["t"]] = e
            elif e.get("type") == "paper_close": closes.append(e)
    both = [t for t in dec if t in out]
    cal = {q: brier([out[t]["probs"][q] for t in both], [out[t]["outcomes"][q] for t in both]) for q in QUESTIONS} if both else {}
    losses = []
    for c in closes:
        if c["pnl"] > 0: continue
        d = dec.get(c["decisionT"]); o = out.get(c["decisionT"])
        why = []
        if o:
            if o["outcomes"]["direction"] != (1 if c["side"] == "long" else 0): why.append("direction call wrong")
            if o["outcomes"]["risk"] == 0: why.append("volatility expansion (risk question said calm)")
            if o["outcomes"]["regime"] == 0 and c["reason"] == "time": why.append("range-bound: time exit")
        if c["reason"] in ("global_kill", "drawdown_halt", "flatten"): why.append(f"forced exit: {c['reason']}")
        losses.append(dict(t=c["decisionT"], side=c["side"], reason=c["reason"], pnl=c["pnl"], root_cause=why or ["unclassified"]))
    pnl = [c["pnl"] for c in closes]
    return dict(decisions=len(dec), resolved=len(both), fired=sum(1 for d in dec.values() if str(d.get("action", "")).startswith("paper")),
                paper_trades=len(closes), paper_net=float(np.sum(pnl)) if pnl else 0.0, paper_hit=float(np.mean(np.array(pnl) > 0)) if pnl else None,
                calibration={q: {k: v for k, v in c.items() if k != "reliability"} for q, c in cal.items()}, losses=losses)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", default=os.path.expanduser("~/.quasaria-office/state/calibration.jsonl"))
    ap.add_argument("--out", default=os.path.expanduser("~/.quasaria-office/nightly"))
    ap.add_argument("--ship", action="store_true")
    ap.add_argument("--model-dest", default=None)
    ap.add_argument("--skip-research", action="store_true")
    a = ap.parse_args()
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    d = os.path.join(a.out, day); os.makedirs(d, exist_ok=True)
    rv = review(a.log)
    json.dump(rv, open(os.path.join(d, "review.json"), "w"), indent=1, default=float)
    prop = dict(day=day, review=dict((k, rv[k]) for k in ("decisions", "resolved", "fired", "paper_trades", "paper_net", "paper_hit")), shipped=False)
    if not a.skip_research:
        env = dict(os.environ, QUANT_OUT=os.path.join(d, "study"), QUANT_NOW=str(int(time.time() // 3600 * 3600)),
                   QUANT_MODEL_OUT=os.path.join(d, "proposed.model.json"), QUANT_FIXTURE_OUT=os.path.join(d, "parity.json"))
        for step in (["fetch.py"], ["run_gate.py"], ["analyze_gate.py"]):
            r = subprocess.run([sys.executable, os.path.join(HERE, *step)], env=env, capture_output=True, text=True, timeout=4 * 3600)
            open(os.path.join(d, "research.log"), "a").write(f"$ {step}\n{r.stdout[-4000:]}\n{r.stderr[-4000:]}\n")
            if r.returncode != 0: prop["error"] = f"{step[0]} failed"; break
        gp = os.path.join(d, "study", "gate.json")
        if os.path.exists(gp):
            g = json.load(open(gp)); prop["gate"] = dict(passed=g["passed"], checks=g["checks"], best=dict((k, g["best"][k]) for k in ("tf", "tp_atr", "sl_atr", "model", "trades", "net", "hit", "sharpe", "max_dd", "tstat", "dsr")))
            if g["passed"] and a.ship and a.model_dest:
                shutil.copy(os.path.join(d, "proposed.model.json"), a.model_dest); prop["shipped"] = True
            prop["decision"] = "shipped (gate passed)" if prop["shipped"] else ("gate passed; not shipped (run with --ship to replace the model file)" if g["passed"] else "not shipped: proposal failed the strategy gate")
    json.dump(prop, open(os.path.join(d, "proposal.json"), "w"), indent=1, default=float)
    print(json.dumps(prop, default=float)[:2000])


if __name__ == "__main__":
    main()
