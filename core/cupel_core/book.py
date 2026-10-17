"""The book's arithmetic: a mix of runs held in pools of accounts, rebalanced each period, its withdrawal by
Monte Carlo, and the weights that best meet a builder's objective. Taken out of cupel's 4_book.py line for line
(OPPORTUNITY-PLAN-APPS.md A1) so that one code computes a book wherever it runs: 4_book.py on the server, and the
user's own application (CPython and Pyodide alike).

It takes arrays and a Settings bundle, queries nothing, and holds no state of its own: two calculations in one
process share nothing. Every function that reads a setting takes the bundle `s` first.
"""
import time

import numpy as np
from scipy.optimize import minimize

from .settings import CoreError, Settings  # noqa: F401
from .stats import stats


def asof(days, src_days, src_vals):
    """src_vals carried forward onto `days` (NaN before the first src day)."""
    idx = np.searchsorted(src_days, days, side="right") - 1
    out = np.where(idx >= 0, src_vals[np.clip(idx, 0, None)], np.nan)
    return out


def period_ids(s, days):
    """Each day's rebalance period, as an increasing integer."""
    y = days.astype("datetime64[Y]").astype(int)
    m = days.astype("datetime64[M]").astype(int)
    return {"M": m, "Q": y * 4 + (m % 12) // 3, "Y": y, "none": np.zeros(len(days), int)}[s.rebalance]


def mulberry32(a):
    """web/lib/montecarlo.js's generator, bit for bit (uint32 arithmetic)."""
    a &= 0xFFFFFFFF

    def rnd():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = ((a ^ (a >> 15)) * (1 | a)) & 0xFFFFFFFF
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return rnd


class Paths:
    """s.mc_paths x s.mc_years*12 indices into a history of `n_returns` monthly returns,
    drawn as montecarlo.js draws them, and each month's withdrawal factor."""

    def __init__(self, s, n_returns, inflation=None, years=None):
        self.s = s
        inflation = s.mc_inflation if inflation is None else inflation
        months = (s.mc_years if years is None else years) * 12
        rnd = mulberry32(s.mc_seed)
        idx = np.empty((s.mc_paths, months), dtype=np.int64)
        for p in range(s.mc_paths):
            for m in range(0, months, s.mc_block):
                s0 = int(rnd() * n_returns)
                for k in range(min(s.mc_block, months - m)):
                    idx[p, m + k] = (s0 + k) % n_returns
        self.idx = idx
        self.n_returns = n_returns
        self.wf = (1 + inflation) ** (np.arange(months) // 12)     # month m's withdrawal / the first month's

    def per_path(self, r):
        """Each path's largest withdrawal, a year, as a share of the starting wealth.

        A path pays every withdrawal iff the start covers them all, each discounted by
        the path's growth before it: W = 12 / sum_m wf_m / prod_{j<m} (1 + r_j).
        Returns (W per path, the discounted terms)."""
        g = 1 + r[self.idx]
        disc = np.cumprod(np.c_[np.ones(len(g)), g[:, :-1]], axis=1)
        terms = self.wf / disc
        return 12 / terms.sum(axis=1), terms


def withdrawal(s, r, paths=None, inflation=None):
    """The largest yearly withdrawal (share of the start) whose ruin rate is at most s.mc_ruin."""
    paths = paths or Paths(s, len(r), s.mc_inflation if inflation is None else inflation)
    w, _ = paths.per_path(r)
    return float(np.sort(w)[int(s.mc_ruin * s.mc_paths)])


def month_ends(days):
    """Indices of each calendar month's last day in `days` (montecarlo.js monthlyReturns)."""
    mon = days.astype("datetime64[M]")
    return np.flatnonzero(np.r_[mon[1:] != mon[:-1], True])


class Rebalanced:
    """The book's CAD equity for weights w, each pool and its loan rebalanced every period.

    `pools[i]` is the index in s.pool_keys of the pool column i is held in. For a
    day in period p, a run's growth since the close of the last day of period
    p-1 (since the first day, in the first period) is units[t] / units[base].
    A pool with base capital B and exposure E = sum of its weights grows by
    sum(w * growth) / B - (E / B - 1) * (1 + r * years since that close) within
    a period, r being the rate of the pool's currency for the day's month, and
    by the product of its period-end growths across periods.
    """

    def __init__(self, s, units, days, pools, mfac=None):
        self.s = s
        per = period_ids(s, days)
        # each column's buying power per unit of its value, per day: max(1, the run's margin) (phase 2a). A run's
        # own cash still counts as held, as before; only exposure above the run's equity adds.
        self.mfac = np.ones_like(units) if mfac is None else mfac
        first = np.r_[True, per[1:] != per[:-1]]
        starts = np.flatnonzero(first)
        self.ends = np.r_[starts[1:] - 1, len(days) - 1]
        base = np.zeros(len(days), int)
        for k, st in enumerate(starts):
            base[st:self.ends[k] + 1] = 0 if k == 0 else st - 1
        self.growth = units / units[:, base]           # runs x days
        tau = (days - days[base]).astype("timedelta64[D]").astype(float) / 365.25
        months = days.astype("datetime64[M]").astype("datetime64[D]")
        self.carry = {}
        for sleeve in {k[0] for k in s.pool_keys}:
            rate = np.array([s.rates[sleeve].get(m, np.nan) for m in months])
            if np.isnan(rate).any():
                missing = sorted({str(m) for m, r in zip(months, rate) if np.isnan(r)})
                raise CoreError(f"no {sleeve} margin rate for {missing[:3]}...; run 1_fx.py")
            self.carry[sleeve] = 1 + rate * tau
        self.pidx = np.cumsum(first) - 1                # period index of each day
        self.days = days
        # a pool with no column holds nothing and adds nothing
        self.masks = {j: pools == j for j in range(len(s.pool_keys)) if (pools == j).any()}

    def curve(self, w):
        return self._parts(w)[0]

    def _parts(self, w):
        total, parts = 0.0, {}
        for j, m in self.masks.items():
            share, carry = self.s.pool_share[self.s.pool_keys[j]], self.carry[self.s.pool_keys[j][0]]
            ws = w[m]
            # by the pool's base, not ws.sum(): what is above the base is borrowed
            g = ws @ self.growth[m] / share - (ws.sum() / share - 1) * carry
            ge = g[self.ends]
            carried = np.r_[1.0, np.cumprod(ge)[:-1]]
            total = total + share * carried[self.pidx] * g
            parts[j] = (m, g, ge, carried)
        return total, parts

    def withdrawal(self, w, paths):
        """(-smoothed withdrawal, its gradient, the exact withdrawal), a year, as a share of the start.

        The book's calendar-month returns R feed `paths`; each path's W is 12 / S with
        S = sum_k wf_k / D_k, so dW/dR_h = 12 / S^2 * sum over the draws j of month h of
        (the terms after j) / (1 + R_h). R_h is a ratio of month-end equities, whose
        gradients are exact (as in objective()).
        """
        eq, parts = self._parts(w)
        n = len(w)
        me = month_ends(self.days)
        E = eq[me]
        if eq.min() <= 0 or len(E) < 3:
            return 10.0, np.zeros(n), 0.0
        R = E[1:] / E[:-1] - 1
        W, terms = paths.per_path(R)
        order = np.argsort(W)
        k = int(self.s.mc_ruin * self.s.mc_paths)
        band = order[max(0, k - self.s.mc_band):k + self.s.mc_band + 1]
        # d W / d R, averaged over the band
        gR = np.zeros(len(R))
        for q in band:
            after = np.cumsum(terms[q][::-1])[::-1] - terms[q]        # sum of terms after each draw
            gR += 12 / (1 / W[q] * 12) ** 2 * np.bincount(paths.idx[q], weights=after, minlength=len(R))
        gR = gR / (1 + R) / len(band)
        # d R / d w from the month-end equities' gradients
        pre = {}
        for j, (m, g, ge, carried) in parts.items():
            share, carry = self.s.pool_share[self.s.pool_keys[j]], self.carry[self.s.pool_keys[j][0]]
            d = (self.growth[m][:, self.ends] - carry[self.ends]) / share / ge
            pre[j] = (m, g, carried, np.cumsum(d, axis=1) - d, share, carry)
        dE = np.zeros((len(me), n))
        for i, t in enumerate(me):
            p = self.pidx[t]
            for m, g, carried, s_excl, share, carry in pre.values():
                dE[i, m] = share * carried[p] * (g[t] * s_excl[:, p] + (self.growth[m][:, t] - carry[t]) / share)
        dR = (dE[1:] - (1 + R)[:, None] * dE[:-1]) / E[:-1, None]
        grad = gR @ dR
        return -float(W[band].mean()), -grad, float(W[order[k]])

    def daily(self, w):
        """(the book's equity on every day, its gradient: columns x days), the same terms as withdrawal()'s."""
        eq, parts = self._parts(w)
        dE = np.zeros((len(w), len(self.days)))
        for j, (m, g, ge, carried) in parts.items():
            share, carry = self.s.pool_share[self.s.pool_keys[j]], self.carry[self.s.pool_keys[j][0]]
            d = (self.growth[m][:, self.ends] - carry[self.ends]) / share / ge
            s_excl = (np.cumsum(d, axis=1) - d)[:, self.pidx]
            dE[m] = share * carried[self.pidx] * (g * s_excl + (self.growth[m] - carry) / share)
        return eq, dE

    def sortino(self, w):
        """(-Sortino, its gradient), as stats() measures it: daily returns, annualized by the days a year."""
        eq, dE = self.daily(w)
        if eq.min() <= 0:
            return 10.0, np.zeros(len(w))
        r = eq[1:] / eq[:-1] - 1
        n = len(r)
        ann = np.sqrt(n / ((self.days[-1] - self.days[0]).astype("timedelta64[D]").astype(float) / 365.25))
        neg = np.minimum(r, 0)
        D = np.sqrt(np.mean(neg ** 2))
        if D <= 0:
            return 10.0, np.zeros(len(w))
        mu = r.mean()
        c = ann * (1 / (n * D) - mu * neg / (n * D ** 3))          # d Sortino / d r_t
        grad = dE[:, 1:] @ (c / eq[:-1]) - dE[:, :-1] @ (c * (1 + r) / eq[:-1])
        return -mu / D * ann, -grad

    def growth_and_drawdown(self, w):
        """(-log of the final equity, its gradient, the max drawdown, its gradient on the deepest day)."""
        eq, dE = self.daily(w)
        if eq.min() <= 0:
            return 10.0, np.zeros(len(w)), 1.0, np.zeros(len(w))
        peak_i = np.maximum.accumulate(np.where(eq == np.maximum.accumulate(eq), np.arange(len(eq)), 0))
        dd = 1 - eq / eq[peak_i]
        t = int(np.argmax(dd))
        s = peak_i[t]
        g_dd = -(dE[:, t] * eq[s] - eq[t] * dE[:, s]) / eq[s] ** 2
        return -np.log(eq[-1] / eq[0]), -(dE[:, -1] / eq[-1] - dE[:, 0] / eq[0]), float(dd[t]), g_dd

    def margin_room(self, w):
        """(least share of buying power left on any day, its gradient).

        On day t the margin pool holds H = carried * sum(w * growth) (its loan
        included) and may hold L = self.s.buying_power_mult x (its equity + TFSA1's
        value), TFSA1 being self.s.collateral_in_pool of the CAD registered pool's equity.
        The room is 1 - H / L, a share, so a tight day in 2008 counts as much as
        one in 2026 when the book is many times larger. The gradient is taken on
        the tightest day, the same way as the drawdown's.
        """
        jm = self.s.pool_keys.index(("CAD", True)) if ("CAD", True) in self.s.pool_keys else None
        if jm is None or jm not in self.masks or not self.s.buying_power_mult:
            return 1.0, np.zeros(len(w))
        jr = self.s.pool_keys.index(("CAD", False)) if ("CAD", False) in self.s.pool_keys else None
        _, parts = self._parts(w)

        def pieces(j):
            m, g, ge, carried = parts[j]
            share, carry = self.s.pool_share[self.s.pool_keys[j]], self.carry[self.s.pool_keys[j][0]]
            d = (self.growth[m][:, self.ends] - carry[self.ends]) / share / ge   # runs x periods
            return m, g, carried[self.pidx], np.cumsum(d, axis=1) - d, share, carry

        mM, gM, cM, sM, shM, carM = pieces(jm)
        held = w[mM] @ (self.growth[mM] * self.mfac[mM])
        H = cM * held
        L = self.s.buying_power_mult * shM * cM * gM
        r = jr is not None and jr in self.masks
        if r:
            mR, gR, cR, sR, shR, carR = pieces(jr)
            L = L + self.s.buying_power_mult * self.s.collateral_in_pool * shR * cR * gR
        if L.min() <= 0:
            return -1.0, np.zeros(len(w))      # the collateral is gone: no mix like this is allowed
        room = 1 - H / L
        t = int(np.argmin(room))
        p = self.pidx[t]
        dH, dL = np.zeros(len(w)), np.zeros(len(w))
        dH[mM] = cM[t] * (self.growth[mM][:, t] * self.mfac[mM][:, t] + held[t] * sM[:, p])
        dL[mM] = self.s.buying_power_mult * shM * cM[t] * (gM[t] * sM[:, p] + (self.growth[mM][:, t] - carM[t]) / shM)
        if r:
            dL[mR] = self.s.buying_power_mult * self.s.collateral_in_pool * shR * cR[t] * (
                gR[t] * sR[:, p] + (self.growth[mR][:, t] - carR[t]) / shR)
        return room[t], -(dH * L[t] - H[t] * dL) / L[t] ** 2


class Spec:
    """What a builder fits, beside the pools' own rules: the objective and every limit a book sets.

    Per column (a run in a pool): `run`, the index of its run; `tier`, 0 primary, 1
    secondary. Per run: `lo` / `hi`, its least and most weight (summed over its
    pools; lo is a hard floor, for a strategy the book must hold). Per tier:
    `share`, (least, most) of what the book holds. `clusters`, groups of runs that
    move together, each held at most `cluster_max` of the book. `margin`, the most
    the margin pool may borrow, as a share of the capital; `max_dd`, the cagr_dd
    builder's drawdown ceiling.
    """

    def __init__(self, builder, run, tier, n_runs, margin, max_dd=None):
        self.builder, self.margin, self.max_dd = builder, margin, max_dd
        self.run, self.tier = np.asarray(run), np.asarray(tier)
        self.lo, self.hi = np.zeros(n_runs), np.full(n_runs, np.inf)
        self.share = {}          # tier -> (least, most)
        self.clusters, self.cluster_max = [], None
        # runs whose most weight is a constraint over their columns; the rest have it only per
        # column, and join this set when a fit breaks it (a few hundred rows slow SLSQP badly)
        self.hi_rows = set()

    run_mfac, mfac_days = None, None     # runs x book days: max(1, margin) (phase 2a); set by build_book
    family = None                         # per run index: its family id (phase 6); set by build_book

    def mfac_for(self, days):
        """The margin factors of this spec's columns on `days` (a window of the book's days), or None."""
        if self.run_mfac is None:
            return None
        idx = np.searchsorted(self.mfac_days, days)
        return self.run_mfac[self.run][:, idx]

    def subset(self, keep):
        s = Spec.__new__(Spec)
        s.__dict__.update(self.__dict__)
        s.run, s.tier = self.run[keep], self.tier[keep]
        return s


def optimize(s, units, days, pools, starts, spec, label="", say=print):
    """The weights that best meet the spec's builder: the largest withdrawal at s.mc_ruin risk of
    ruin (withdrawal), the largest Sortino (sortino), or the largest growth with max drawdown at
    most spec.max_dd (cagr_dd).

    Each pool is fully invested; a pool that may not borrow is invested exactly;
    what the pools that may borrow hold above their bases is at most spec.margin, and
    within the buying power every day; each run, tier and cluster within the spec's
    limits. Returns (w, feasible). When no start reaches a feasible mix, returns the
    best found and feasible=False.
    """
    margin = spec.margin
    book = Rebalanced(s, units, days, pools, spec.mfac_for(days))
    paths = Paths(s, len(month_ends(days)) - 1)
    masks = {j: pools == j for j in range(len(s.pool_keys)) if (pools == j).any()}
    lever = np.array([s.pool_keys[j][1] for j in pools])
    lever_base = sum(s.pool_share[s.pool_keys[j]] for j in masks if s.pool_keys[j][1])
    n = len(pools)

    cache = {}

    def ev(w):
        # (objective to minimize, its gradient, ...) from one evaluation
        key = w.tobytes()
        if key not in cache:
            cache.clear()
            wc = np.clip(w, 0, None)
            if spec.builder == "withdrawal":
                cache[key] = book.withdrawal(wc, paths)
            elif spec.builder == "sortino":
                cache[key] = book.sortino(wc)
            else:   # cagr_dd: (-log growth, its gradient, the max drawdown, its gradient)
                cache[key] = book.growth_and_drawdown(wc)
        return cache[key]

    mcache = {}

    def mev(w):
        # buying power left on the tightest day, and its gradient
        key = w.tobytes()
        if key not in mcache:
            mcache.clear()
            mcache[key] = book.margin_room(np.clip(w, 0, None))
        return mcache[key]

    cons = []
    for j, m in masks.items():
        share = s.pool_share[s.pool_keys[j]]
        cons.append({"type": "ineq", "fun": (lambda w, m=m, s=share: w[m].sum() - s),
                     "jac": (lambda w, m=m: m.astype(float))})
        if not s.pool_keys[j][1]:
            cons.append({"type": "ineq", "fun": (lambda w, m=m, s=share: s - w[m].sum()),
                         "jac": (lambda w, m=m: -m.astype(float))})
    if lever.any():
        cons.append({"type": "ineq", "fun": lambda w: margin - (w[lever].sum() - lever_base),
                     "jac": lambda w: -lever.astype(float)})
    if lever.any():
        cons.append({"type": "ineq", "fun": lambda w: mev(w)[0], "jac": lambda w: mev(w)[1]})
    bounds = [[0, s.pool_share[s.pool_keys[j]] + (margin if s.pool_keys[j][1] else 0)] for j in pools]
    # each run's least and most weight: a bound when the run has one column; else its least is a
    # constraint, and its most bounds each column, and is a constraint once a fit breaks it (hi_rows)
    rows_lo = []
    multi = {}
    for r in np.unique(spec.run):
        cols_r = np.flatnonzero(spec.run == r)
        lo_r, hi_r = spec.lo[r], spec.hi[r]
        for c in cols_r:
            bounds[c][1] = min(bounds[c][1], hi_r)
        if len(cols_r) == 1:
            bounds[cols_r[0]][0] = max(bounds[cols_r[0]][0], lo_r)
            continue
        multi[r] = cols_r
        if lo_r > 0:
            row = np.zeros(n)
            row[cols_r] = 1.0
            rows_lo.append((row, lo_r))
    if rows_lo:
        A, b = np.array([r for r, _ in rows_lo]), np.array([x for _, x in rows_lo])
        cons.append({"type": "ineq", "fun": lambda w, A=A, b=b: A @ w - b, "jac": lambda w, A=A: A})

    def hi_cons():
        rows = [r for r in sorted(spec.hi_rows) if r in multi and np.isfinite(spec.hi[r])]
        if not rows:
            return []
        A = np.zeros((len(rows), n))
        for i, r in enumerate(rows):
            A[i, multi[r]] = 1.0
        b = np.array([spec.hi[r] for r in rows])
        return [{"type": "ineq", "fun": lambda w, A=A, b=b: b - A @ w, "jac": lambda w, A=A: -A}]

    def broken_hi(w):
        return {r for r, cols_r in multi.items() if np.isfinite(spec.hi[r]) and w[cols_r].sum() > spec.hi[r] + 1e-7}
    ones = np.ones(n)
    # a tier's share of what the book holds: least x total <= the tier <= most x total
    for t, (least, most) in spec.share.items():
        mt = (spec.tier == t).astype(float)
        if least:
            cons.append({"type": "ineq", "fun": lambda w, mt=mt, a=least: mt @ w - a * w.sum(),
                         "jac": lambda w, mt=mt, a=least: mt - a * ones})
        if most is not None and most < 1:
            cons.append({"type": "ineq", "fun": lambda w, mt=mt, a=most: a * w.sum() - mt @ w,
                         "jac": lambda w, mt=mt, a=most: a * ones - mt})
    # a cluster of runs that move together: at most cluster_max of what the book holds
    groups = [np.isin(spec.run, g).astype(float) for g in spec.clusters]
    groups = [g for g in groups if g.sum() > 1]
    if groups and spec.cluster_max is not None:
        G = np.array(groups)
        cons.append({"type": "ineq", "fun": lambda w, G=G: spec.cluster_max * w.sum() - G @ w,
                     "jac": lambda w, G=G: spec.cluster_max * np.ones((len(G), n)) - G})
    if spec.builder == "cagr_dd":
        cons.append({"type": "ineq", "fun": lambda w: spec.max_dd - ev(w)[2], "jac": lambda w: -ev(w)[3]})
    bounds = [tuple(b) for b in bounds]

    def feasible_mix(w):
        for c in cons:
            if np.min(np.atleast_1d(c["fun"](w))) < -1e-6:
                return False
        return not broken_hi(w) and all(lo - 1e-9 <= x <= hi + 1e-9 for x, (lo, hi) in zip(w, bounds))

    best, best_any = None, None
    for k, w0 in enumerate(starts):
        t0 = time.time()
        for _ in range(6):
            res = minimize(lambda w: ev(w)[0], w0, jac=lambda w: ev(w)[1], method="SLSQP", bounds=bounds,
                           constraints=cons + hi_cons(), options={"maxiter": 300, "ftol": 1e-10})
            w = np.clip(res.x, 0, None)
            broke = broken_hi(w) - spec.hi_rows
            if not broke:
                break
            say(f"  {label}start {k + 1}: {len(broke)} strategies above their most weight across pools; refitting "
                  f"with that as a constraint", flush=True)
            spec.hi_rows |= broke
            w0 = w
        feasible = feasible_mix(w)
        curve = book.curve(w)
        so, cg, dd = stats(curve, days)
        if spec.builder == "withdrawal":
            wd = ev(w)[2]
            head = f"withdrawal {wd * s.book_cad:,.0f} {s.ccy} a year ({wd:.2%} of the start)"
        else:
            wd = None
            head = f"Sortino {so:.4f}"
        score = {"withdrawal": wd, "sortino": so, "cagr_dd": cg}[spec.builder]
        say(f"  {label}start {k + 1}/{len(starts)}: {head}, "
              f"CAGR {cg:.2%}, max drawdown {dd:.2%}{'' if feasible else ' (breaks a constraint)'}, "
              f"{res.nit} iterations, {time.time() - t0:.0f}s", flush=True)
        if feasible and (best is None or score > best[1]):
            best = (w, score)
        if best_any is None or score > best_any[1]:
            best_any = (w, score)
    if best is not None:
        return best[0], True
    return best_any[0], False


def equal_weights(s, pools):
    """Each pool's base spread equally over its columns (no margin)."""
    return np.array([s.pool_share[s.pool_keys[j]] / (pools == j).sum() for j in pools])


def seeded_starts(s, pools, n, rng):
    """Equal weights on the base, then random mixes on the base (no margin)."""
    starts = [equal_weights(s, pools)]
    for _ in range(n - 1):
        w0 = np.zeros(len(pools))
        for j in set(pools.tolist()):
            m = pools == j
            w0[m] = rng.dirichlet(np.ones(m.sum())) * s.pool_share[s.pool_keys[j]]
        starts.append(w0)
    return starts


def meet_tiers(s, w0, pools, spec):
    """A start moved to meet the primary tier's least share: in each pool that holds both tiers,
    the primaries' part scaled up (each pool keeping its base), and every column within its most
    weight. SLSQP started far outside a share constraint spends most of its time getting inside."""
    w = w0.copy()
    least = spec.share.get(0, (0, None))[0]
    hi_col = spec.hi[spec.run]
    if least:
        prim = spec.tier == 0
        both, only_p = [], 0.0
        for j in set(pools.tolist()):
            m = pools == j
            if (m & prim).any() and (m & ~prim).any():
                both.append(j)
            elif (m & prim).any():
                only_p += s.pool_share[s.pool_keys[j]]
        base_both = sum(s.pool_share[s.pool_keys[j]] for j in both)
        if base_both > 0:
            f = min(1.0, max(0.0, (least - only_p) / base_both + 0.02))
            for j in both:
                m = pools == j
                base = s.pool_share[s.pool_keys[j]]
                for sel, part in ((m & prim, f), (m & ~prim, 1 - f)):
                    tot = w[sel].sum()
                    w[sel] = w[sel] * part * base / tot if tot > 0 else part * base / sel.sum()
    return np.minimum(w, hi_col)


def window(units, days, lo, hi):
    """units and days restricted to [lo, hi], each run re-based to 1 on the first day."""
    m = (days >= np.datetime64(lo)) & (days <= np.datetime64(hi))
    u = units[:, m]
    return u / u[:, :1], days[m]
