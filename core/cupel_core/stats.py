"""The measures of a daily equity curve that 3_backtest.py and 4_book.py both use, defined once.

A run's stored metrics are not these: the database measures every DONE run (schema.sql curve_metrics; the
website's browser twin is web/lib/metrics.js, kept equal by tests/test_metrics.py). These are the scripts' own,
for curves that are no run's stored ones: a book's candidate mixes, a run against a relative on their shared days.
Sortino is the mean daily return over the root-mean-square of the negative ones (target 0), annualized by the
square root of the days a year observed, as curve_metrics measures it.
"""
import numpy as np

# Returns correlated at this or more move together: the rating's clusters (the trial count), the book's clusters
# (max_per_cluster), and a relative that "moves with" a strategy (STRATEGY-VARIATIONS.md §3.2)
MOVES_WITH = 0.9
# a curve shorter than this many days is not rated
RATING_MIN_DAYS = 250


def stats(eq, days):
    """(sortino, cagr, max drawdown) of an equity series on `days` (numpy datetime64[D])."""
    ret = eq[1:] / eq[:-1] - 1
    years = (days[-1] - days[0]).astype("timedelta64[D]").astype(float) / 365.25
    down = np.sqrt(np.mean(np.minimum(ret, 0) ** 2))
    sortino = np.mean(ret) / down * np.sqrt(len(ret) / years) if down > 0 else np.nan
    cagr = (eq[-1] / eq[0]) ** (1 / years) - 1 if eq[-1] > 0 else -1.0
    mdd = np.max(1 - eq / np.maximum.accumulate(eq))
    return float(sortino), float(cagr), float(mdd)


def under_water(eq, days):
    """The longest stretch from a high to the next equal-or-higher close, in days, and its (from, to)."""
    peak_i, longest, span = 0, 0, (days[0], days[0])
    for i in range(1, len(eq)):
        if eq[i] >= eq[peak_i]:
            gap = int((days[i] - days[peak_i]).astype("timedelta64[D]").astype(int))
            if gap > longest:
                longest, span = gap, (days[peak_i], days[i])
            peak_i = i
    gap = int((days[-1] - days[peak_i]).astype("timedelta64[D]").astype(int))
    if gap > longest:
        longest, span = gap, (days[peak_i], "still under")
    return longest, span


def worst_fall(days, vals):
    """(the deepest fall as a positive share, its peak day, its trough day) of a daily curve."""
    peak = np.maximum.accumulate(vals)
    dd = vals / peak - 1
    k = int(np.argmin(dd))
    return float(-dd[k]), str(days[int(np.argmax(vals[:k + 1]))]), str(days[k])
