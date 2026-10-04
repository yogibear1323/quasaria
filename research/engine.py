"""Event-driven (numba) single-desk backtester mirroring the Quasaria fleet/demo fill, fee, sizing and risk model.

Model (see frontend/src/lib/demo/engine.ts, bot/src/office/{sizing,risk}.ts, contracts/leverage-vault):
  * decisions on CLOSED bars at the close (= oracle price); entry fill = close +/- slippage (5 bps adverse)
  * open fee 10 bps of notional (vault charges NO close fee); exits at price +/- 5 bps slippage, take-profit exact
  * stop / take-profit checked on later bars' high/low, stop first if both hit (conservative);
    gap through stop fills at the bar open (conservative; demo replay fills at the stop price)
  * stop clamped to [0.8 %, 7.5 %]; stop-distance sizing incl. 0.25 % fee buffer, risk % of desk equity,
    1.5x equity notional cap, 25 % margin cap, desk leverage cap, half-liquidation-distance rule, 10-unit min margin
  * desk gates: daily loss 3 % (entries blocked to 00:00 UTC), drawdown 10 % -> halt + flatten
    (research: modeled as an operator reset after `halt_reset_sec`), 5-loss streak -> 4 h pause,
    6 entries / desk / 24 h, max 2 open per desk
  * funding: hourly rate series (>0 longs pay) accrued on open notional
Not modeled: fleet-wide caps (single desk at 1 % risk never binds them), drift halts, oracle staleness blocks.
"""
import numpy as np
from numba import njit

REASONS = ["stop", "tp", "signal", "time", "halt", "end"]

@njit(cache=True)
def _size(equity, risk_pct, entry, stop, max_lev, P):
    # P: fee_bps, slip_bps, mm, min_margin, fee_buffer_pct, max_notional_x, max_margin_pct, hard_max_risk
    stop_dist = abs(entry - stop) / entry
    eff = stop_dist + P[4] / 100.0
    risk = equity * min(risk_pct, P[7]) / 100.0
    if risk <= 0: return 0.0, 0.0, 0.0
    notional = min(risk / eff, P[5] * equity)
    lev_by_stop = 1.0 / (2 * stop_dist + P[2])
    maxlev = min(max_lev, lev_by_stop)
    if maxlev < 1: return 0.0, 0.0, 0.0
    margin_cap = equity * P[6] / 100.0
    lev = max(1.0, notional / margin_cap)
    if lev > maxlev:
        lev = maxlev
        notional = min(notional, margin_cap * lev)
    lev = np.ceil(lev * 10) / 10
    if lev > maxlev: lev = np.floor(maxlev * 10) / 10
    if lev < 1: lev = 1.0
    margin = notional / lev
    if margin < P[3]:
        if notional < P[3]: return 0.0, 0.0, 0.0
        margin = P[3]
        lev = np.floor(notional / margin * 10) / 10
        if lev < 1: lev = 1.0
        margin = notional / lev
    return notional, margin, notional * eff

@njit(cache=True)
def simulate(t, o, h, l, c, ent_side, ent_stop, ent_tp, ex_long, ex_short, tr_long, tr_short, fund_h, base_sec,
             time_stop_sec, risk_pct, max_lev, equity0, P, G):
    # G: min_stop%, max_stop%, daily_loss%, dd_halt%, loss_streak, pause_sec, entries_per_day, max_open, halt_reset_sec, gap_conservative
    n = len(c)
    MAXP = 4
    p_on = np.zeros(MAXP, np.bool_); p_side = np.zeros(MAXP); p_entry = np.zeros(MAXP); p_size = np.zeros(MAXP)
    p_margin = np.zeros(MAXP); p_stop = np.zeros(MAXP); p_tp = np.zeros(MAXP); p_fund = np.zeros(MAXP)
    p_fee = np.zeros(MAXP); p_risk = np.zeros(MAXP); p_open_i = np.zeros(MAXP, np.int64)
    trades = np.zeros((n // 2 + 10, 11))  # entry_i, exit_i, side, entry, exit, notional, risk, pnl_net, fee, funding, reason
    nt = 0
    cash = equity0
    eq_curve = np.zeros(n)
    peak = equity0; day_start_eq = equity0; cur_day = -1
    streak = 0; paused_until = -1; halted_until = -1
    entry_times = np.full(64, -1e18); et_k = 0
    halts = 0
    slip = P[1] / 10000.0
    for i in range(n):
        # 1) funding accrual (rate per hour)
        for k in range(MAXP):
            if p_on[k]:
                p_fund[k] += p_size[k] * fund_h[i] * (base_sec / 3600.0) * p_side[k]
        # 2) stop / take-profit on this bar's range (positions opened on earlier bars)
        for k in range(MAXP):
            if not p_on[k] or p_open_i[k] >= i: continue
            s = p_side[k]
            sl_hit = (s > 0 and l[i] <= p_stop[k]) or (s < 0 and h[i] >= p_stop[k])
            tp_hit = p_tp[k] > 0 and ((s > 0 and h[i] >= p_tp[k]) or (s < 0 and l[i] <= p_tp[k]))
            px = 0.0; reason = -1
            if sl_hit:
                px = p_stop[k]
                if G[9] > 0:
                    if s > 0 and o[i] < px: px = o[i]
                    if s < 0 and o[i] > px: px = o[i]
                px = px * (1 - slip * s); reason = 0
            elif tp_hit:
                px = p_tp[k]; reason = 1
            if reason >= 0:
                raw = s * (px - p_entry[k]) / p_entry[k] * p_size[k] - p_fund[k]
                pnl = max(raw, -p_margin[k])
                cash += pnl
                trades[nt, 0] = p_open_i[k]; trades[nt, 1] = i; trades[nt, 2] = s; trades[nt, 3] = p_entry[k]; trades[nt, 4] = px
                trades[nt, 5] = p_size[k]; trades[nt, 6] = p_risk[k]; trades[nt, 7] = pnl - p_fee[k]; trades[nt, 8] = p_fee[k]
                trades[nt, 9] = -p_fund[k]; trades[nt, 10] = reason; nt += 1
                streak = 0 if pnl > 0 else streak + 1
                p_on[k] = False
        # equity / day roll / peak
        unreal = 0.0; nopen = 0
        for k in range(MAXP):
            if p_on[k]:
                unreal += p_side[k] * (c[i] - p_entry[k]) / p_entry[k] * p_size[k] - p_fund[k]; nopen += 1
        eq = cash + unreal
        d = t[i] // 86400
        if d != cur_day:
            cur_day = d; day_start_eq = eq
        if t[i] >= halted_until and halted_until > 0:
            halted_until = -1; peak = eq  # operator reset after halt
        peak = max(peak, eq)
        # 3) halt check
        if halted_until < 0 and peak > 0 and (peak - eq) / peak * 100 >= G[3]:
            halts += 1
            halted_until = t[i] + G[8]
            for k in range(MAXP):
                if p_on[k]:
                    s = p_side[k]; px = c[i] * (1 - slip * s)
                    raw = s * (px - p_entry[k]) / p_entry[k] * p_size[k] - p_fund[k]
                    pnl = max(raw, -p_margin[k]); cash += pnl
                    trades[nt, 0] = p_open_i[k]; trades[nt, 1] = i; trades[nt, 2] = s; trades[nt, 3] = p_entry[k]; trades[nt, 4] = px
                    trades[nt, 5] = p_size[k]; trades[nt, 6] = p_risk[k]; trades[nt, 7] = pnl - p_fee[k]; trades[nt, 8] = p_fee[k]
                    trades[nt, 9] = -p_fund[k]; trades[nt, 10] = 4; nt += 1
                    p_on[k] = False
            eq_curve[i] = cash
            continue
        if halted_until > 0:
            eq_curve[i] = eq; continue
        # 4) manage (signal exits, time stop, trailing) at this close
        for k in range(MAXP):
            if not p_on[k] or p_open_i[k] >= i: continue
            s = p_side[k]
            ex = (s > 0 and ex_long[i]) or (s < 0 and ex_short[i])
            reason = 2
            if not ex and time_stop_sec > 0 and (t[i] - t[p_open_i[k]]) > time_stop_sec:
                ex = True; reason = 3
            if ex:
                px = c[i] * (1 - slip * s)
                raw = s * (px - p_entry[k]) / p_entry[k] * p_size[k] - p_fund[k]
                pnl = max(raw, -p_margin[k]); cash += pnl
                trades[nt, 0] = p_open_i[k]; trades[nt, 1] = i; trades[nt, 2] = s; trades[nt, 3] = p_entry[k]; trades[nt, 4] = px
                trades[nt, 5] = p_size[k]; trades[nt, 6] = p_risk[k]; trades[nt, 7] = pnl - p_fee[k]; trades[nt, 8] = p_fee[k]
                trades[nt, 9] = -p_fund[k]; trades[nt, 10] = reason; nt += 1
                streak = 0 if pnl > 0 else streak + 1
                p_on[k] = False
            else:
                if s > 0 and not np.isnan(tr_long[i]) and tr_long[i] > p_stop[k] * 1.0025: p_stop[k] = tr_long[i]
                if s < 0 and not np.isnan(tr_short[i]) and tr_short[i] < p_stop[k] * 0.9975: p_stop[k] = tr_short[i]
        # 5) entry
        side = ent_side[i]
        if side == 0:
            eq_curve[i] = eq; continue
        # recompute equity after exits
        unreal = 0.0; nopen = 0
        for k in range(MAXP):
            if p_on[k]:
                unreal += p_side[k] * (c[i] - p_entry[k]) / p_entry[k] * p_size[k] - p_fund[k]; nopen += 1
        eq = cash + unreal
        ok = True
        if day_start_eq > 0 and (day_start_eq - eq) / day_start_eq * 100 >= G[2]: ok = False
        if streak >= G[4]:
            paused_until = t[i] + G[5]; streak = 0
        if paused_until > t[i]: ok = False
        cnt = 0
        for k in range(64):
            if entry_times[k] > t[i] - 86400: cnt += 1
        if cnt >= G[6]: ok = False
        if nopen >= G[7]: ok = False
        if ok:
            price = c[i]
            dist = (price - ent_stop[i]) / price * side  # positive if stop on correct side
            if not dist > 0: dist = G[0] / 100
            if dist < G[0] / 100: dist = G[0] / 100
            if dist <= G[1] / 100:
                stop = price * (1 - side * dist)
                notional, margin, risk = _size(eq, risk_pct, price, stop, max_lev, P)
                if notional > 0:
                    for k in range(MAXP):
                        if not p_on[k]:
                            fill = price * (1 + slip * side)
                            fee = notional * P[0] / 10000.0
                            cash -= fee
                            p_on[k] = True; p_side[k] = side; p_entry[k] = fill; p_size[k] = notional; p_margin[k] = margin
                            p_stop[k] = stop; tpv = ent_tp[i]
                            p_tp[k] = tpv if (tpv > 0 and ((side > 0 and tpv > price) or (side < 0 and tpv < price))) else 0.0
                            p_fund[k] = 0.0; p_fee[k] = fee; p_risk[k] = risk; p_open_i[k] = i
                            entry_times[et_k % 64] = t[i]; et_k += 1
                            break
        unreal = 0.0
        for k in range(MAXP):
            if p_on[k]: unreal += p_side[k] * (c[i] - p_entry[k]) / p_entry[k] * p_size[k] - p_fund[k]
        eq_curve[i] = cash + unreal
    # close at end
    for k in range(MAXP):
        if p_on[k]:
            s = p_side[k]; px = c[n - 1] * (1 - slip * s)
            raw = s * (px - p_entry[k]) / p_entry[k] * p_size[k] - p_fund[k]
            pnl = max(raw, -p_margin[k]); cash += pnl
            trades[nt, 0] = p_open_i[k]; trades[nt, 1] = n - 1; trades[nt, 2] = s; trades[nt, 3] = p_entry[k]; trades[nt, 4] = px
            trades[nt, 5] = p_size[k]; trades[nt, 6] = p_risk[k]; trades[nt, 7] = pnl - p_fee[k]; trades[nt, 8] = p_fee[k]
            trades[nt, 9] = -p_fund[k]; trades[nt, 10] = 5; nt += 1
    if n: eq_curve[n - 1] = cash
    return trades[:nt], eq_curve, halts

DEFAULT_P = np.array([10.0, 5.0, 0.05, 10.0, 0.25, 1.5, 25.0, 2.0])
DEFAULT_G = np.array([0.8, 7.5, 3.0, 10.0, 5, 14400, 6, 2, 7 * 86400, 1.0])

def run(bars, sig, base_sec, risk_pct=1.0, max_lev=5.0, equity0=500.0, fee_bps=10, slip_bps=5, fund=None, P=None, G=None):
    P = DEFAULT_P.copy() if P is None else P
    P[0] = fee_bps; P[1] = slip_bps
    G = DEFAULT_G if G is None else G
    n = len(bars["c"])
    fund = np.zeros(n) if fund is None else fund
    tr, eq, halts = simulate(bars["t"], bars["o"], bars["h"], bars["l"], bars["c"], sig["side"].astype(np.int8), sig["stop"], sig["tp"],
                             sig["exl"], sig["exs"], sig["trl"], sig["trs"], fund, float(base_sec), float(sig.get("time_stop", 0.0)),
                             risk_pct, max_lev, equity0, P, G)
    return tr, eq, halts

def metrics(tr, eq, equity0=500.0, bars_per_day=24):
    n = len(tr)
    out = {"trades": n}
    if n == 0:
        out.update(avg_win=np.nan, avg_loss=np.nan, win_rate=np.nan, avg_r=np.nan, net=0.0, gross=0.0, fees=0.0, funding=0.0, pf=np.nan, max_dd_pct=0.0, sharpe=np.nan, cost_share=np.nan)
        return out
    pnl = tr[:, 7]; fees = tr[:, 8]; fund = tr[:, 9]
    slip_cost = np.abs(tr[:, 5]) * 2 * 5e-4  # approx 5 bps each side
    gross = pnl + fees - fund + slip_cost  # before fees, slippage, funding
    r = np.where(tr[:, 6] > 0, pnl / tr[:, 6], 0)
    wins = pnl[pnl > 0].sum(); losses = -pnl[pnl <= 0].sum()
    pk = np.maximum.accumulate(np.concatenate([[equity0], eq]))
    dd = ((pk[1:] - eq) / pk[1:]).max() * 100 if len(eq) else 0
    daily = None
    if len(eq) > bars_per_day * 2:
        e = eq[::bars_per_day]; ret = np.diff(e) / e[:-1]
        sh = ret.mean() / ret.std() * np.sqrt(365) if ret.std() > 0 else np.nan
    else:
        sh = np.nan
    costs = fees.sum() + slip_cost.sum()
    out.update(avg_win=float(pnl[pnl > 0].mean()) if (pnl > 0).any() else 0.0, avg_loss=float(pnl[pnl <= 0].mean()) if (pnl <= 0).any() else 0.0,
               win_rate=float((pnl > 0).mean()), avg_r=float(r.mean()), net=float(pnl.sum()), gross=float(gross.sum()), fees=float(fees.sum()),
               slippage=float(slip_cost.sum()), funding=float(fund.sum()), pf=float(wins / losses) if losses > 0 else np.inf,
               max_dd_pct=float(dd), sharpe=float(sh) if sh == sh else np.nan,
               cost_share=float(costs / max(abs(gross).sum(), 1e-9)))
    return out
