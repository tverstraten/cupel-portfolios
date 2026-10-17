"""The small test release the core's and the app's tests run on, and the figures expected of it.

    py core/tests/make_fixture.py           writes core/tests/release/ (manifest.json and the parts, in the format
                                            `py 4_book.py release` writes) and core/tests/expected.json
    py core/tests/make_fixture.py --check   makes them again in memory and says whether the files are the same

Synthetic runs, made from a fixed seed: no price, strategy or rating of cupel's is in it. The files are kept in the
repository, so CPython and Pyodide read the very same bytes; expected.json is what CPython computed from them, and
the other runtime is held to it (tests/test_core.py).
"""
import hashlib
import io
import json
import pathlib
import sys

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from cupel_core.api import Session  # noqa: E402

SEED = 20261005
# (run_id, sleeve, name, daily drift, daily deviation, sells short, first day offset)
RUNS = [(101, "CAD", "Canadian index fund, held", 0.00030, 0.009, False, 0),
        (102, "CAD", "Canadian momentum rotation", 0.00042, 0.011, False, 0),
        (103, "CAD", "Canadian bonds and gold, risk parity", 0.00018, 0.004, False, 30),
        (104, "CAD", "Canadian long/short value", 0.00025, 0.006, True, 0),
        (201, "USD", "US index fund, held", 0.00036, 0.010, False, 0),
        (202, "USD", "US trend following", 0.00030, 0.007, False, 0),
        (203, "USD", "US low volatility", 0.00028, 0.006, False, 60),
        (204, "USD", "US long/short momentum", 0.00022, 0.008, True, 0)]
FIRST, LAST = "2010-01-04", "2025-12-31"

# the books the tests evaluate; BOOK is a Canadian household with a margin account, US a household in the US
BOOK = {"country": "CA", "margin": "on", "buying_power": 300000, "collateral": ["Margin", "TFSA"], "rebalance": "M",
        "years": 30, "ruin": 0.05, "inflation": 0.02,
        "accounts": [{"name": "RRSP", "type": "RRSP", "balance": 400000, "usd": 150000},
                     {"name": "TFSA", "type": "TFSA", "balance": 100000},
                     {"name": "Margin", "type": "MARGIN", "balance": 80000}],
        "holdings": [{"run": 101, "sleeve": "CAD", "lever": False, "weight": 0.25},
                     {"run": 102, "sleeve": "CAD", "lever": False, "weight": 0.20},
                     {"run": 103, "sleeve": "CAD", "lever": False, "weight": 35 / 58 - 0.45},
                     {"run": 104, "sleeve": "CAD", "lever": True, "weight": 0.10},
                     {"run": 102, "sleeve": "CAD", "lever": True, "weight": 0.08},
                     {"run": 201, "sleeve": "USD", "lever": False, "weight": 0.15},
                     {"run": 202, "sleeve": "USD", "lever": False, "weight": 15 / 58 - 0.15}]}
US_BOOK = {"country": "US", "margin": "off", "rebalance": "Q", "years": 25, "ruin": 0.05, "inflation": 0.025,
           "accounts": [{"name": "IRA", "type": "IRA", "balance": 300000},
                        {"name": "Roth", "type": "ROTH_IRA", "balance": 100000}],
           "holdings": [{"run": 201, "sleeve": "USD", "lever": False, "weight": 0.5},
                        {"run": 202, "sleeve": "USD", "lever": False, "weight": 0.3},
                        {"run": 203, "sleeve": "USD", "lever": False, "weight": 0.2}]}


def parquet_bytes(table):
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="zstd")
    return buf.getvalue()


def build():
    """(the manifest, {part name: bytes}), deterministic: the data parts, and `reference.json`, the reference
    portfolios an app's self-check computes and compares (OPPORTUNITY-PLAN-APPS.md B8): what this very core computes
    from the data parts, shipped with them."""
    manifest, parts = data_parts()
    cases = expected(manifest, parts)["self_check"]
    parts["reference.json"] = json.dumps(cases, indent=1, sort_keys=True).encode("utf-8")
    manifest["parts"].append({"part": "reference.json", "sha256": hashlib.sha256(parts["reference.json"]).hexdigest(),
                              "bytes": len(parts["reference.json"])})
    return manifest, parts


def data_parts():
    """The manifest and the Parquet parts."""
    rng = np.random.default_rng(SEED)
    days = np.arange(np.datetime64(FIRST), np.datetime64(LAST) + 1)
    days = days[np.is_busday(days)]
    market = rng.normal(0.0003, 0.008, len(days))
    rows, eq_rows = [], {"run_id": [], "day": [], "equity": [], "gross": [], "margin": []}
    for rid, sleeve, name, mu, sd, shorts, skip in RUNS:
        own = rng.normal(mu, sd, len(days))
        r = (0.5 * market + own) if not shorts else (own - 0.2 * market)
        d = days[skip:]
        eq = 100000 * np.cumprod(1 + r[skip:])
        gross = np.full(len(d), 1.6 if shorts else 1.0)
        rows.append(dict(run_id=rid, strategy_id=rid, variation_id=rid, sleeve=sleeve, name=name,
                         source="synthetic: core/tests/make_fixture.py", rules="# synthetic", published=None,
                         evidence_from=None, is_anchor=True, finished_at="2026-10-05T00:00:00+00:00",
                         grade="C", evidence_status="inconclusive", fidelity="B", oos_years=0.0, shorts=shorts,
                         crypto=False, first_day=str(d[0]), last_day=str(d[-1]),
                         cagr=float((eq[-1] / eq[0]) ** (365.25 / (d[-1] - d[0]).astype(int)) - 1)))
        eq_rows["run_id"] += [rid] * len(d)
        eq_rows["day"] += [x.astype(object) for x in d]
        eq_rows["equity"] += eq.tolist()
        eq_rows["gross"] += gross.tolist()
        eq_rows["margin"] += gross.tolist()
    fx = 1.25 + 0.1 * np.sin(np.arange(len(days)) / 400.0)
    months = np.unique(days.astype("datetime64[M]")).astype("datetime64[D]")
    mr = {"month": [], "sleeve": [], "prime": [], "rate": []}
    for i, m in enumerate(months):
        for sleeve, base in (("CAD", 3.0), ("USD", 3.5)):
            prime = base + 1.5 * np.sin(i / 30.0)
            mr["month"].append(m.astype(object)); mr["sleeve"].append(sleeve)
            mr["prime"].append(float(prime)); mr["rate"].append(float(prime + 1))
    parts = {
        "runs.parquet": parquet_bytes(pa.Table.from_pylist(rows)),
        "equity/0000101-0000204.parquet": parquet_bytes(pa.table({
            "run_id": pa.array(eq_rows["run_id"], pa.int32()), "day": pa.array(eq_rows["day"], pa.date32()),
            "equity": pa.array(eq_rows["equity"], pa.float64()), "gross": pa.array(eq_rows["gross"], pa.float64()),
            "margin": pa.array(eq_rows["margin"], pa.float64())})),
        "fx.parquet": parquet_bytes(pa.table({"day": pa.array([x.astype(object) for x in days], pa.date32()),
                                              "cad_per_usd": fx.tolist()})),
        "margin_rate.parquet": parquet_bytes(pa.table({"month": pa.array(mr["month"], pa.date32()), "sleeve": mr["sleeve"],
                                                       "prime": mr["prime"], "rate": mr["rate"]})),
    }
    manifest = {"format": 1, "release_id": 1, "as_of": LAST, "rating_method": "fixture", "made_at": "2026-10-05 00:00:00",
                "base_release": None, "runs": len(RUNS),
                "parts": [{"part": k, "sha256": hashlib.sha256(v).hexdigest(), "bytes": len(v)} for k, v in parts.items()]}
    return manifest, parts


def expected(manifest, parts):
    """What the core computes from the fixture, under the runtime this is run in."""
    s = Session()
    s.open(manifest, parts.__getitem__)
    out = {"book": s.evaluate(BOOK), "us_book": s.evaluate(US_BOOK), "pools": s.pools(BOOK), "optimize": {}}
    for k in ("book", "us_book"):
        # the curve is held to its first, last and total, not kept day by day
        c = out[k].pop("curve")
        out[k]["curve_check"] = {"n": len(c["days"]), "first": c["equity"][0], "last": c["equity"][-1], "sum": sum(c["equity"])}
    for builder in ("withdrawal", "sortino", "cagr_dd", "equal"):
        got = s.optimize(BOOK, builder, [101, 102, 103, 104, 201, 202, 203], starts=2, max_dd=0.35)
        out["optimize"][builder] = {"feasible": got["feasible"], "holdings": got["holdings"],
                                    "withdrawal": got["evaluation"].get("withdrawal"), "cagr": got["evaluation"].get("cagr")}
    keep = ("withdrawal", "withdrawal_flat", "cagr", "sortino", "max_drawdown", "final")
    out["self_check"] = [{"name": "a Canadian household with a margin account", "book": BOOK,
                          "expect": {k: out["book"][k] for k in keep}},
                         {"name": "a US household, quarterly", "book": US_BOOK,
                          "expect": {k: out["us_book"][k] for k in keep}}]
    return out


def same_release(manifest, parts, folder):
    """Whether the release in `folder` holds what `build()` makes: the same parts with the same rows. (Not the same
    bytes: a Parquet file names the library version that wrote it, so another version of pyarrow writes other bytes
    for the same table. The files in the repository are the ones every test reads; this says they are this script's.)"""
    kept = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    names = lambda m: {**m, "parts": [p["part"] for p in m["parts"]]}  # noqa: E731
    if names(kept) != names(manifest):
        return False
    for k, v in parts.items():
        have = (folder / k).read_bytes()
        if k.endswith(".parquet"):
            if not pq.read_table(io.BytesIO(have)).equals(pq.read_table(io.BytesIO(v))):
                return False
        elif json.loads(have) != json.loads(v):
            return False
    return True


def main():
    manifest, parts = build()
    exp = json.dumps(expected(manifest, parts), indent=1, sort_keys=True)
    rel = HERE / "release"
    if "--check" in sys.argv:
        same = same_release(manifest, parts, rel) \
            and json.loads((HERE / "expected.json").read_text(encoding="utf-8")) == json.loads(exp)
        print("the files are what this script makes" if same else "the files differ from what this script makes")
        sys.exit(0 if same else 1)
    for k, v in parts.items():
        (rel / k).parent.mkdir(parents=True, exist_ok=True)
        (rel / k).write_bytes(v)
    (rel / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8", newline="\n")
    (HERE / "expected.json").write_text(exp, encoding="utf-8", newline="\n")
    print(f"release: {len(parts)} parts, {sum(len(v) for v in parts.values()):,} bytes; expected.json: {len(exp):,} characters")


if __name__ == "__main__":
    main()
