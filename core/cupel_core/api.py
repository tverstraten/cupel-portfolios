"""The core as the user's application calls it: plain values in, plain values out (what crosses from the app's
screens to the Python running beside them). A `Session` holds the release in hand and nothing about any user:
every call is given the book it is about.

A book, as entered:
    {"country": "CA", "accounts": [{"name", "type", "balance", "usd", "fx_fee"}], "buying_power": 0,
     "collateral": [account names], "margin": "on" | "off" | amount, "rebalance": "M", "years": 30, "ruin": 0.05,
     "inflation": 0.02, "holdings": [{"run", "sleeve", "lever", "weight"}]}
"""
import numpy as np

from . import book as B
from .accounts import ACCOUNT_TYPES, CURRENCY, account, book_settings, pool_label
from .evaluate import book_arrays, evaluate
from .release import Release
from .settings import CoreError

SEED = 20260922            # cupel's builder's (4_book.py SEED): the same starts for the same book
HELD = 1e-6                # a strategy counts as held at a weight above this share of the capital
BUILDERS = {"withdrawal": "the largest withdrawal at the stated risk of running out",
            "sortino": "the largest Sortino",
            "cagr_dd": "the largest growth with the worst fall at most max_dd",
            "equal": "each pool spread equally over the strategies it may hold"}
# what a self-check compares, and how closely the two must agree (the same code and data: rounding only)
CHECKED = ("withdrawal", "withdrawal_flat", "cagr", "sortino", "max_drawdown", "final")
TOLERANCE = 1e-9


def account_types(country):
    """The country's account types, as a screen lists them."""
    return [{"type": k, "may_lever": v[1], "may_short": v[2], "sleeves": list(v[3]), "note": v[4]}
            for k, v in ACCOUNT_TYPES.items() if v[0] == country]


def settings_of(book, rates):
    country = book.get("country", "CA")
    if country not in CURRENCY:
        raise CoreError(f"cupel covers Canada and the United States, not {country!r}")
    accounts = [account(a["name"], a["type"], a["balance"], a.get("usd", 0), a.get("fx_fee", 0), country)
                for a in book.get("accounts", [])]
    names = [a[0] for a in accounts]
    if len(set(names)) != len(names):
        raise CoreError("two accounts have the same name")
    collateral = [c for c in book.get("collateral", [])]
    for c in collateral:
        if c not in names:
            raise CoreError(f"the collateral names an account that is not there: {c}")
    return book_settings(accounts, rates, margin=book.get("margin", "off"), buying_power=float(book.get("buying_power") or 0),
                         collateral=collateral, rebalance=book.get("rebalance", "M"), years=int(book.get("years", 30)),
                         ruin=float(book.get("ruin", 0.05)), inflation=float(book.get("inflation", 0.02)),
                         ccy=CURRENCY[country])


class Session:
    def __init__(self):
        self.rel = None

    def _release(self):
        if self.rel is None:
            raise CoreError("no release is open: the data has not been downloaded yet")
        return self.rel

    def open(self, manifest, get_part):
        """Read and check a release; it becomes the one in hand only if every part verifies."""
        rel = Release(manifest, get_part)
        self.rel = rel
        return {"as_of": rel.as_of, "rating_method": rel.rating_method, "runs": len(rel.runs),
                "parts": len(manifest["parts"])}

    def catalogue(self):
        return self._release().catalogue()

    def pools(self, book):
        """The pools the book's accounts form: what a screen shows before anything is held."""
        rel = self._release()
        s, extra = settings_of(book, rel.rates)
        return {"currency": s.ccy, "capital": s.book_cad, "margin_most": extra["margin_cad"],
                "pools": [{"sleeve": k[0], "lever": k[1], "label": pool_label(k), "share": s.pool_share[k],
                           "amount": extra["pools"][k]["cad"], "may_short": extra["pools"][k]["may_short"],
                           "accounts": extra["pools"][k]["accounts"]} for k in s.pool_keys]}

    def evaluate(self, book, detail=True):
        rel = self._release()
        s, extra = settings_of(book, rel.rates)
        return evaluate(s, extra, rel, book.get("holdings", []), detail=detail)

    def optimize(self, book, builder, runs, starts=3, max_dd=None, say=None):
        """The weights of the given strategies that best meet the builder, for the book's accounts: cupel's own
        optimizer (book.optimize) over the list as given. It applies the accounts' rules (what may borrow, what may
        sell short, the buying power); it does not apply a cupel book's screens, tiers or family limits, which are
        cupel's choices for its own examples. Returns {holdings, feasible, evaluation}."""
        if builder not in BUILDERS:
            raise CoreError(f"{builder!r} is not a builder: {', '.join(BUILDERS)}")
        if builder == "cagr_dd" and not (max_dd and 0 < float(max_dd) < 1):
            raise CoreError("the cagr_dd builder needs max_dd, the worst fall allowed, as a share (0.25)")
        rel = self._release()
        s, extra = settings_of(book, rel.rates)
        runs = list(dict.fromkeys(int(r) for r in runs))
        if not runs:
            raise CoreError("no strategies were given to choose among")
        cols, col_run = [], []
        for i, rid in enumerate(runs):
            run = rel.runs.get(rid)
            if run is None:
                raise CoreError(f"run {rid} is not in this release (as of {rel.as_of})")
            margin = rel.curve(rid)[2]
            margin_unknown = bool(run.get("shorts")) and bool(np.isnan(margin).all())
            for k in s.pool_keys:
                if k[0] == run["sleeve"] and (not run.get("shorts") or extra["pools"][k]["may_short"]) \
                        and not (k[1] and margin_unknown):
                    cols.append({"run": rid, "sleeve": k[0], "lever": k[1], "weight": 0.0})
                    col_run.append(i)
        for k in s.pool_keys:
            if not any((c["sleeve"], c["lever"]) == k for c in cols):
                raise CoreError(f"none of the strategies given may be held in the {pool_label(k)} accounts: their "
                                f"{extra['pools'][k]['cad']:,.2f} {s.ccy} has nothing to hold")
        days, units, pools, mfac = book_arrays(s, rel, cols)
        if builder == "equal":
            w, feasible = B.equal_weights(s, pools), True
        else:
            spec = B.Spec(builder, col_run, [0] * len(cols), len(runs), extra["margin_share"],
                          float(max_dd) if max_dd else None)
            spec.run_mfac = np.array([mfac[col_run.index(i)] for i in range(len(runs))])
            spec.mfac_days = days
            rng = np.random.default_rng(SEED)
            w0 = [B.meet_tiers(s, x, pools, spec) for x in B.seeded_starts(s, pools, max(1, int(starts)), rng)]
            w, feasible = B.optimize(s, units, days, pools, w0, spec, say=say or (lambda *a, **k: None))
        held = [dict(c, weight=float(x)) for c, x in zip(cols, w) if x > HELD]
        return {"builder": builder, "feasible": bool(feasible), "holdings": held,
                "evaluation": evaluate(s, extra, rel, held, detail=False),
                "note": "fitted to these accounts and this list as given; cupel's own examples add screens and limits"}

    def self_check(self, cases):
        """Each reference case computed here and compared with the figures stored for it: [{name, ok, differences}].
        A case: {"name", "book", "expect": {figure: value}}. A figure that differs by more than TOLERANCE (relative)
        fails its case."""
        out = []
        for case in cases:
            try:
                got = self.evaluate(case["book"], detail=False)
            except CoreError as e:
                out.append({"name": case["name"], "ok": False, "differences": [{"figure": "error", "said": str(e)}]})
                continue
            diffs = []
            for k in CHECKED:
                if k not in case["expect"]:
                    continue
                want, have = case["expect"][k], got.get(k)
                if have is None or abs(have - want) > TOLERANCE * max(1.0, abs(want)):
                    diffs.append({"figure": k, "expected": want, "computed": have,
                                  "by": None if have is None else have - want})
            out.append({"name": case["name"], "ok": not diffs, "differences": diffs})
        return out
