"""Evaluate mode (OPPORTUNITY-PLAN-APPS.md A1, B4; OPPORTUNITY.md part 6): the book a person entered, computed as
entered. Its holdings and weights are given. It is never changed to fit a rule: a rule it breaks is said, with what
breaks it, and the figures are those of the book as given.

A holding is a run held in a pool: {"run": run_id, "sleeve": "CAD"|"USD", "lever": bool, "weight": share of the
capital}. The accounts of one pool hold the same mix, each in proportion to its money, as in cupel's builder.
"""
import numpy as np

from . import book as B
from .accounts import pool_label
from .settings import CoreError
from .stats import stats, under_water, worst_fall

CASH = "cash"          # the part of a pool that is not invested: held as cash, earning nothing
QS = (0.05, 0.25, 0.5, 0.75, 0.95)


def book_arrays(s, rel, holdings, window=None):
    """(days, units: holdings x days, pools: each holding's pool index, mfac) of the holdings over the days every one
    of them covers: from the latest first day to the earliest last day, on every day any of them has a bar; a run's
    equity (and the rate) carried forward over a day it has none. A USD run's curve is in the book's currency."""
    if not holdings:
        raise CoreError("the book holds nothing")
    curves = []
    for h in holdings:
        key = (h["sleeve"], bool(h["lever"]))
        if key not in s.pool_keys:
            raise CoreError(f"the book has no {pool_label(key)} money to hold run {h['run']} in")
        run = rel.runs.get(h["run"])
        if run is None:
            raise CoreError(f"run {h['run']} is not in this release (as of {rel.as_of})")
        if run["sleeve"] != h["sleeve"]:
            raise CoreError(f"run {h['run']} is a {run['sleeve']} run: it cannot be held in {h['sleeve']} money")
        curves.append(rel.curve(h["run"]))
    lo = max(d[0] for d, _, _ in curves)
    hi = min(d[-1] for d, _, _ in curves)
    if window:
        lo = max(lo, np.datetime64(window[0])) if window[0] else lo
        hi = min(hi, np.datetime64(window[1])) if window[1] else hi
    if not lo < hi:
        raise CoreError("the holdings share no days: no window covers them all")
    days = np.unique(np.concatenate([d[(d >= lo) & (d <= hi)] for d, _, _ in curves]))
    if len(days) < 3:
        raise CoreError("the holdings share fewer than three days")
    fx_on = B.asof(days, rel.fx_days, rel.fx_vals) if s.ccy == "CAD" else None
    units, mfac = [], []
    for h, (d, v, m) in zip(holdings, curves):
        u = B.asof(days, d, v) * (fx_on if (h["sleeve"] == "USD" and fx_on is not None) else 1)
        if np.isnan(u).any():
            raise CoreError(f"run {h['run']} has no value on some of the book's days (a missing exchange rate?)")
        units.append(u / u[0])
        mfac.append(np.maximum(1.0, np.nan_to_num(B.asof(days, d, m), nan=1.0)))
    pools = np.array([s.pool_keys.index((h["sleeve"], bool(h["lever"]))) for h in holdings])
    return days, np.array(units), pools, np.array(mfac)


def with_cash(s, units, pools, w, mfac):
    """The arrays with one more column per pool that is not fully invested: its cash, flat, at the weight left
    over. Returns (units, pools, w, mfac, {pool index: the cash share})."""
    cash = {}
    for j in sorted(set(pools.tolist())):
        left = s.pool_share[s.pool_keys[j]] - w[pools == j].sum()
        if left > 1e-9:
            cash[j] = float(left)
    if not cash:
        return units, pools, w, mfac, cash
    n = units.shape[1]
    units = np.vstack([units] + [np.ones(n)] * len(cash))
    mfac = np.vstack([mfac] + [np.ones(n)] * len(cash))
    pools = np.r_[pools, list(cash)]
    w = np.r_[w, [cash[j] for j in cash]]
    return units, pools, w, mfac, cash


def fan(s, r, annual, start=1.0, qs=QS, paths=None):
    """Wealth percentiles at each year end while paying `annual` a year (rising by the inflation), from `start`:
    web/lib/montecarlo.js's fan, on the same draws. `r`: the book's calendar-month returns."""
    paths = paths or B.Paths(s, len(r))
    g = 1 + r[paths.idx]
    n, months = g.shape
    v = np.full(n, float(start))
    out = [dict(year=0, q=[float(start)] * len(qs), ruined=0.0, withdrawal=0.0)]
    for m in range(months):
        pay = annual / 12 * (1 + s.mc_inflation) ** (m // 12)
        v = np.where(v < pay, 0.0, (v - pay) * g[:, m])
        if (m + 1) % 12 == 0:
            year = (m + 1) // 12
            srt = np.sort(v)
            out.append(dict(year=year, q=[float(srt[min(n - 1, int(q * n))]) for q in qs],
                            ruined=float((srt <= 0).mean()),
                            withdrawal=float(annual * (1 + s.mc_inflation) ** (year - 1))))
    return out


def breaks(s, extra, rel, holdings, w, pools, book):
    """Every rule the book as given breaks, each in words: [{rule, what}]."""
    out = []
    for h in holdings:
        run = rel.runs[h["run"]]
        key = (h["sleeve"], bool(h["lever"]))
        if run.get("shorts") and not extra["pools"][key]["may_short"]:
            out.append(dict(rule="short", what=f"{run['name']} sells short, and the {pool_label(key)} accounts may not"))
        if h["weight"] < 0:
            out.append(dict(rule="negative", what=f"{run['name']} has a weight below zero"))
    lever_over = 0.0
    for j, key in enumerate(s.pool_keys):
        held = float(w[pools == j].sum()) if (pools == j).any() else 0.0
        base = s.pool_share[key]
        if held > base + 1e-9:
            if not key[1]:
                out.append(dict(rule="borrow", what=f"the {pool_label(key)} accounts hold {held / base:.1%} of their "
                                                    f"money: they cannot borrow the {held / base - 1:.1%} above it"))
            else:
                lever_over += held - base
    if lever_over > extra["margin_share"] + 1e-9:
        out.append(dict(rule="margin", what=f"the margin accounts borrow {lever_over * s.book_cad:,.0f} {s.ccy}: the "
                                            f"most they may is {extra['margin_cad']:,.0f}"))
    room, _ = book.margin_room(np.clip(w, 0, None))
    if room < -1e-9:
        out.append(dict(rule="buying_power", what=f"on its tightest day the margin accounts hold {-room:.1%} more "
                                                  f"than their buying power allows"))
    return out


def measure(s, units, days, pools, w, mfac, paths=None):
    """(the curve, the calendar-month returns, the exact withdrawal) of weights w; the withdrawal is None for a
    curve that reaches zero or has under three month ends."""
    book = B.Rebalanced(s, units, days, pools, mfac)
    eq = book.curve(w)
    me = B.month_ends(days)
    if eq.min() <= 0 or len(me) < 3:
        return book, eq, None, None
    r = eq[me][1:] / eq[me][:-1] - 1
    return book, eq, r, B.withdrawal(s, r, paths)


def evaluate(s, extra, rel, holdings, window=None, detail=True):
    """The book as given: its curve and figures, its withdrawal and its range of futures, what each holding adds,
    what moving each weight does, and every rule it breaks.

    Returns a dict of plain values (lists, numbers, strings): what a screen shows, and what is compared when the
    same book is computed in two places."""
    holdings = [dict(h, weight=float(h["weight"])) for h in holdings]
    days, units, pools, mfac = book_arrays(s, rel, holdings, window)
    w = np.array([h["weight"] for h in holdings])
    n = len(holdings)
    broken = []
    u2, p2, w2, m2, cash = with_cash(s, units, pools, np.clip(w, 0, None), mfac)
    # the draws depend only on how many months the book has: made once, used for every variant of it below
    paths = B.Paths(s, len(B.month_ends(days)) - 1) if len(B.month_ends(days)) >= 3 else None
    book, eq, r, wd = measure(s, u2, days, p2, w2, m2, paths)
    broken += breaks(s, extra, rel, holdings, w, pools, B.Rebalanced(s, units, days, pools, mfac))
    out = {"as_of": rel.as_of, "rating_method": rel.rating_method, "currency": s.ccy, "capital": s.book_cad,
           "first_day": str(days[0]), "last_day": str(days[-1]), "days": int(len(days)),
           "cash": {pool_label(s.pool_keys[j]): share for j, share in cash.items()},
           "breaks": broken,
           "labels": ["hindsight experiment: fixed weights replayed over the past, chosen knowing it",
                      "strategy weights are not orders, and a curve scaled to a balance is a standardized model"]}
    if eq.min() <= 0:
        out.update(ruined=True, ruined_on=str(days[int(np.argmax(eq <= 0))]))
        return out
    so, cg, dd = stats(eq, days)
    longest, span = under_water(eq, days)
    fall, fall_from, fall_to = worst_fall(days, eq)
    out.update(ruined=False, sortino=so, cagr=cg, max_drawdown=dd,
               under_water_days=longest, under_water_from=str(span[0]), under_water_to=str(span[1]),
               worst_fall=fall, worst_fall_from=fall_from, worst_fall_to=fall_to,
               curve={"days": [str(d) for d in days], "equity": (eq * s.book_cad).tolist()},
               final=float(eq[-1] * s.book_cad))
    if wd is None:
        out["withdrawal"] = None
        return out
    out.update(withdrawal=wd, withdrawal_amount=wd * s.book_cad,
               withdrawal_flat=B.withdrawal(s, r, inflation=0.0),
               monte_carlo={"years": s.mc_years, "ruin": s.mc_ruin, "inflation": s.mc_inflation, "paths": s.mc_paths,
                            "months": int(len(r)), "fan": fan(s, r, wd * s.book_cad, s.book_cad, paths=paths)})
    if not detail:
        return out

    def without(i):
        # the book without holding i: its weight spread over the rest of its pool in proportion (cash, if alone)
        keep = np.arange(n) != i
        wk = np.clip(w[keep], 0, None).copy()
        same = pools[keep] == pools[i]
        tot = wk[same].sum()
        if tot > 0:
            wk[same] *= (tot + max(w[i], 0)) / tot
        a = with_cash(s, units[keep], pools[keep], wk, mfac[keep])
        return measure(s, a[0], days, a[1], a[2], a[3], paths)[3]

    def moved(i, by):
        # holding i moved by `by` of the capital, the rest of its pool moved the other way in proportion
        wk = np.clip(w, 0, None).copy()
        same = (pools == pools[i]) & (np.arange(n) != i)
        tot = wk[same].sum()
        step = max(-wk[i], by)
        if tot <= 0 and step > 0:
            return None                        # nothing in its pool to take from: it would be borrowed
        if tot > 0:
            step = min(step, tot)
            wk[same] *= (tot - step) / tot
        wk[i] += step
        a = with_cash(s, units, pools, wk, mfac)
        return measure(s, a[0], days, a[1], a[2], a[3], paths)[3]

    per = []
    for i, h in enumerate(holdings):
        gone = without(i) if n > 1 else None
        up, down = moved(i, 0.05), moved(i, -0.05)
        per.append({"run": h["run"], "sleeve": h["sleeve"], "lever": bool(h["lever"]), "weight": h["weight"],
                    "name": rel.runs[h["run"]]["name"],
                    "adds": None if gone is None else wd - gone,          # to the withdrawal, a share of the capital
                    "plus_5": None if up is None else up - wd, "minus_5": None if down is None else down - wd})
    out["holdings"] = per
    return out
