"""The core's tests, run under CPython (pytest) and under Pyodide (core/tests/run_pyodide.mjs, which calls every
test_ function here): the same figures in both, from the same release files (OPPORTUNITY-PLAN-APPS.md A1, A2, A3).

Plain functions with plain asserts and no fixtures, so both runners can call them. A figure is compared with
expected.json (what CPython computed, make_fixture.py) to REL, and a difference is reported with its size.
"""
import copy
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
REL = 1e-9          # two runtimes, the same code and data: rounding only


def load():
    from cupel_core.api import Session
    manifest = json.loads((HERE / "release" / "manifest.json").read_text(encoding="utf-8"))
    s = Session()
    s.open(manifest, lambda part: (HERE / "release" / part).read_bytes())
    return s, manifest, json.loads((HERE / "expected.json").read_text(encoding="utf-8"))


def differences(got, want, path="", out=None):
    """Every place two results differ by more than REL: [(where, got, want, by)]."""
    out = [] if out is None else out
    if isinstance(want, dict):
        for k in want:
            if not isinstance(got, dict) or k not in got:
                out.append((f"{path}.{k}", "missing", want[k], None))
            else:
                differences(got[k], want[k], f"{path}.{k}", out)
        for k in (got if isinstance(got, dict) else {}):
            if k not in want:
                out.append((f"{path}.{k}", got[k], "not expected", None))
    elif isinstance(want, list):
        if not isinstance(got, list) or len(got) != len(want):
            out.append((path, f"{len(got) if isinstance(got, list) else got} items", f"{len(want)} items", None))
        else:
            for i, (g, w) in enumerate(zip(got, want)):
                differences(g, w, f"{path}[{i}]", out)
    elif isinstance(want, float) and isinstance(got, (int, float)) and not isinstance(got, bool):
        if abs(got - want) > REL * max(1.0, abs(want)):
            out.append((path, got, want, got - want))
    elif got != want:
        out.append((path, got, want, None))
    return out


def checked(result):
    r = dict(result)
    c = r.pop("curve")
    r["curve_check"] = {"n": len(c["days"]), "first": c["equity"][0], "last": c["equity"][-1], "sum": sum(c["equity"])}
    return r


def book():
    from make_fixture import BOOK
    return copy.deepcopy(BOOK)


def raises(fn, *words):
    from cupel_core.settings import CoreError
    try:
        fn()
    except CoreError as e:
        assert all(w in str(e) for w in words), f"said {e!s}, not {words}"
        return str(e)
    raise AssertionError(f"nothing was refused; expected {words}")


def test_the_release_is_read_and_every_part_checked():
    s, manifest, _ = load()
    assert len(s.rel.runs) == manifest["runs"] == 8
    cat = s.catalogue()
    assert [r["run_id"] for r in cat] == sorted(s.rel.runs) and all(isinstance(r["name"], str) for r in cat)
    days, eq, margin = s.rel.curve(104)
    assert len(days) == len(eq) == len(margin) and str(days[0]) == "2010-01-04" and float(margin[0]) == 1.6
    assert set(s.rel.rates) == {"CAD", "USD"}


def test_a_changed_part_is_refused_and_the_release_in_hand_is_kept():
    from cupel_core.api import Session
    s, manifest, _ = load()
    part = "equity/0000101-0000204.parquet"
    good = (HERE / "release" / part).read_bytes()
    flipped = good[:1000] + bytes([good[1000] ^ 1]) + good[1001:]
    other = Session()
    raises(lambda: other.open(manifest, lambda p: flipped if p == part else (HERE / "release" / p).read_bytes()), "checksum")
    assert other.rel is None
    raises(lambda: other.open(manifest, lambda p: good[:-1] if p == part else (HERE / "release" / p).read_bytes()), "bytes")
    raises(lambda: s.open(manifest, lambda p: flipped if p == part else (HERE / "release" / p).read_bytes()), "checksum")
    assert s.rel is not None and len(s.rel.runs) == 8                      # the one it had is still the one in hand
    raises(lambda: Session().open(dict(manifest, format=2), lambda p: b""), "format")
    raises(lambda: Session().catalogue(), "no release")


def test_account_types_are_the_countrys():
    from cupel_core import api
    from cupel_core.accounts import account
    assert sorted(t["type"] for t in api.account_types("CA")) == ["LIF", "MARGIN", "RRSP", "TFSA"]
    assert sorted(t["type"] for t in api.account_types("US")) == ["BROKERAGE", "IRA", "ROTH_IRA"]
    assert [t["type"] for t in api.account_types("CA") if t["may_lever"]] == ["MARGIN"]
    assert account("a", "MARGIN", 10)[3:5] == (True, True) and account("a", "TFSA", 10)[3:5] == (False, False)
    raises(lambda: account("a", "IRA", 10, country="CA"), "not an account type of CA")
    raises(lambda: account("a", "RRSP", 10, country="US"), "not an account type of US")
    raises(lambda: account("a", "RRSP", 0), "more than zero")
    raises(lambda: account("a", "RRSP", 10, usd=11), "US dollars")
    assert account("a", "IRA", 10, country="US")[5] == 10.0                # a US account is all US dollars


def test_the_pools_are_the_accounts_money():
    s, _, exp = load()
    got = s.pools(book())
    assert not differences(got, exp["pools"]), differences(got, exp["pools"])
    assert abs(sum(p["share"] for p in got["pools"]) - 1) < 1e-12 and got["capital"] == 580000.0
    assert got["margin_most"] == 300000 - 80000


def test_the_book_as_entered_gives_the_expected_figures():
    s, _, exp = load()
    for name, b in (("book", book()), ("us_book", exp["self_check"][1]["book"])):
        got = checked(s.evaluate(b))
        d = differences(got, exp[name])
        assert not d, f"{name}: {len(d)} figures differ, the first {d[:3]}"
    e = exp["book"]
    assert e["breaks"] == [] and e["cash"] == {} and 0 < e["withdrawal"] < 0.2 and e["currency"] == "CAD"
    assert exp["us_book"]["currency"] == "USD"


def test_the_range_of_futures_is_the_withdrawals():
    s, _, _ = load()
    r = s.evaluate(book())
    mc = r["monte_carlo"]
    assert len(mc["fan"]) == mc["years"] + 1 and mc["fan"][0]["q"] == [580000.0] * 5
    # the withdrawal is the most that leaves at most `ruin` of the paths ruined: the fan, paying it, shows that share
    assert abs(mc["fan"][-1]["ruined"] - mc["ruin"]) <= 1.5 / mc["paths"]
    assert all(a["q"] == sorted(a["q"]) for a in mc["fan"])
    assert abs(mc["fan"][1]["withdrawal"] - r["withdrawal_amount"]) < 1e-6
    assert r["withdrawal_flat"] > r["withdrawal"]                          # no yearly rise pays more at the start


def test_a_broken_rule_is_said_and_the_book_is_not_changed():
    s, _, _ = load()
    b = book()
    b["holdings"][0]["weight"] += 0.05                                     # the registered accounts above their money
    r = s.evaluate(b)
    assert [x["rule"] for x in r["breaks"]] == ["borrow"] and "cannot borrow" in r["breaks"][0]["what"]
    assert r["holdings"][0]["weight"] == b["holdings"][0]["weight"]         # as entered
    b = book()
    b["holdings"][1] = {"run": 104, "sleeve": "CAD", "lever": False, "weight": 0.20}     # a short seller, registered
    assert "short" in [x["rule"] for x in s.evaluate(b)["breaks"]]
    b = book()
    b["margin"] = "off"                                                    # the margin accounts still hold 18% on 13.8%
    assert "margin" in [x["rule"] for x in s.evaluate(b)["breaks"]]
    b = book()
    b["buying_power"] = 90000                                              # barely above the margin account itself
    assert {"margin", "buying_power"} & {x["rule"] for x in s.evaluate(b)["breaks"]}


def test_money_not_invested_is_cash_and_earns_nothing():
    s, _, _ = load()
    b = book()
    full = s.evaluate(b, detail=False)
    b["holdings"] = [h for h in b["holdings"] if h["sleeve"] == "CAD"] + [
        {"run": 201, "sleeve": "USD", "lever": False, "weight": 0.10}]      # of the 25.9% in US dollars
    part = s.evaluate(b, detail=False)
    assert list(part["cash"]) == ["USD registered"] and abs(part["cash"]["USD registered"] - (15 / 58 - 0.10)) < 1e-12
    assert part["breaks"] == [] and part["cagr"] < full["cagr"]


def test_what_cannot_be_computed_is_refused_in_words():
    s, _, _ = load()
    b = book()
    b["holdings"][0]["run"] = 999
    raises(lambda: s.evaluate(b), "999", "not in this release")
    b = book()
    b["holdings"][0]["sleeve"] = "USD"
    raises(lambda: s.evaluate(b), "CAD run")
    b = book()
    b["accounts"] = [a for a in b["accounts"] if a["type"] != "MARGIN"]
    b["collateral"] = ["TFSA"]
    raises(lambda: s.evaluate(b), "CAD margin")
    b = book()
    b["holdings"] = []
    raises(lambda: s.evaluate(b), "holds nothing")
    b = book()
    b["country"] = "FR"
    raises(lambda: s.evaluate(b), "Canada and the United States")
    b = book()
    b["accounts"][1]["name"] = "RRSP"
    raises(lambda: s.evaluate(b), "same name")


def test_the_optimizer_gives_the_expected_weights():
    s, _, exp = load()
    runs = [101, 102, 103, 104, 201, 202, 203]
    for builder in ("withdrawal", "sortino", "cagr_dd", "equal"):
        said = []
        got = s.optimize(book(), builder, runs, starts=2, max_dd=0.35, say=lambda *a, **k: said.append(a[0]))
        want = exp["optimize"][builder]
        have = {"feasible": got["feasible"], "holdings": got["holdings"],
                "withdrawal": got["evaluation"]["withdrawal"], "cagr": got["evaluation"]["cagr"]}
        # weights come out of an iterative fit: the two runtimes' arithmetic libraries may round a step apart
        d = [x for x in differences(have, want) if x[3] is None or abs(x[3]) > 1e-6]
        assert not d, f"{builder}: {d[:3]}"
        assert got["feasible"] and got["evaluation"]["breaks"] == [], (builder, got["evaluation"]["breaks"])
        assert builder == "equal" or len(said) == 2                        # its progress, a line a start
    best = exp["optimize"]
    assert best["withdrawal"]["withdrawal"] >= max(best[b]["withdrawal"] for b in best) - 1e-9
    assert best["withdrawal"]["withdrawal"] > exp["book"]["withdrawal"]


def test_the_optimizer_keeps_the_accounts_rules():
    s, _, _ = load()
    got = s.optimize(book(), "withdrawal", [101, 104, 201], starts=1)
    assert all(h["lever"] for h in got["holdings"] if h["run"] == 104)     # a short seller only where shorting is allowed
    raises(lambda: s.optimize(book(), "withdrawal", [101, 102]), "USD registered", "nothing to hold")
    raises(lambda: s.optimize(book(), "cagr_dd", [101, 201]), "max_dd")
    raises(lambda: s.optimize(book(), "best", [101, 201]), "not a builder")
    raises(lambda: s.optimize(book(), "equal", []), "no strategies")


def test_the_self_check_passes_and_fails_on_one_altered_value():
    s, _, exp = load()
    ok = s.self_check(exp["self_check"])
    assert [c["ok"] for c in ok] == [True, True], ok
    cases = copy.deepcopy(exp["self_check"])
    cases[1]["expect"]["withdrawal"] *= 1 + 1e-6
    bad = s.self_check(cases)
    assert [c["ok"] for c in bad] == [True, False]
    assert bad[1]["differences"][0]["figure"] == "withdrawal" and abs(bad[1]["differences"][0]["by"]) > 0
    cases[0]["book"]["holdings"][0]["run"] = 999
    assert s.self_check(cases)[0]["differences"][0]["figure"] == "error"


def test_two_books_computed_side_by_side_share_nothing():
    s, _, exp = load()
    from cupel_core import book as B
    from cupel_core.api import settings_of
    us = exp["self_check"][1]["book"]
    s1, _ = settings_of(book(), s.rel.rates)
    s2, _ = settings_of(us, s.rel.rates)
    assert (s1.rebalance, s1.mc_years, s1.ccy) == ("M", 30, "CAD") and (s2.rebalance, s2.mc_years, s2.ccy) == ("Q", 25, "USD")
    a1 = s.evaluate(book(), detail=False)
    a2 = s.evaluate(us, detail=False)
    again = s.evaluate(book(), detail=False)
    assert a1 == again and a1["withdrawal"] != a2["withdrawal"]
    assert not hasattr(B, "REBALANCE") and not hasattr(B, "POOL_KEYS")       # the core has no settings of its own


def test_the_fixture_files_are_what_the_script_makes():
    """Under CPython only (Pyodide has the files, not the means to remake them bit for bit): the release and the
    expected figures in the repository are what make_fixture.py makes today."""
    import sys
    if sys.platform == "emscripten":
        return
    import make_fixture
    manifest, parts = make_fixture.build()
    assert make_fixture.same_release(manifest, parts, HERE / "release")
    d = differences(make_fixture.expected(manifest, parts), json.loads((HERE / "expected.json").read_text(encoding="utf-8")))
    assert not d, d[:3]
