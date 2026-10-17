"""Accounts, what each type allows, and the pools of money they form (OPPORTUNITY-PLAN-APPS.md A1: "account
policies by country"). The policies are cupel's `account_type` table, row for row (cupel's tests hold the two equal).

An account, as the core takes it, is the tuple cupel's builder has always used:
    (name, type, balance, may_lever, may_short, converted to USD, conversion fee)
with every amount in the book's currency. `account()` makes one from what a person enters, applying the type's policy.
"""
from .settings import CoreError, Settings

# account type -> (country, may_lever, may_short, sleeves it may hold, what it is)
ACCOUNT_TYPES = {
    "RRSP": ("CA", False, False, ("CAD", "USD"), "registered: long-only, no borrowing"),
    "TFSA": ("CA", False, False, ("CAD", "USD"), "registered: long-only, no borrowing"),
    "LIF": ("CA", False, False, ("CAD", "USD"), "registered: long-only, no borrowing"),
    "MARGIN": ("CA", True, True, ("CAD", "USD"), "may borrow and sell short"),
    "IRA": ("US", False, False, ("USD",), "traditional or rollover IRA: long-only, no borrowing"),
    "ROTH_IRA": ("US", False, False, ("USD",), "Roth IRA: long-only, no borrowing"),
    "BROKERAGE": ("US", False, False, ("USD",), "taxable brokerage, held as a cash account: long-only, no borrowing"),
}
# the currency a country's books are built and reported in
CURRENCY = {"CA": "CAD", "US": "USD"}


def account(name, kind, balance, usd=0.0, fx_fee=0.0, country="CA"):
    """An account as the core takes it, from what a person enters: its name, its type, its balance and (in Canada)
    the part of it held in US dollars, both in the book's currency. Raises CoreError when the type is not one of the
    country's, or the amounts cannot be."""
    if kind not in ACCOUNT_TYPES or ACCOUNT_TYPES[kind][0] != country:
        mine = sorted(k for k, v in ACCOUNT_TYPES.items() if v[0] == country)
        raise CoreError(f"{kind!r} is not an account type of {country}: {', '.join(mine)}")
    _, lever, short, sleeves, _ = ACCOUNT_TYPES[kind]
    balance, usd, fx_fee = float(balance), float(usd or 0), float(fx_fee or 0)
    if not balance > 0:
        raise CoreError(f"{name}: a balance is more than zero")
    if country == "US":
        usd = balance              # a US account holds US dollars only; the book's currency is USD
        fx_fee = 0.0
    if usd < 0 or usd > balance + 1e-9:
        raise CoreError(f"{name}: the part held in US dollars is between nothing and the balance")
    if not 0 <= fx_fee < 1:
        raise CoreError(f"{name}: the conversion fee is a share between 0 and 1")
    if usd > 0 and "USD" not in sleeves:
        raise CoreError(f"{name}: a {kind} holds no US dollars")
    return (str(name), kind, balance, lever, short, usd, fx_fee)


def pools_of(accounts):
    """The pools: (sleeve, may_lever) -> money in the book's currency, may_short, and each account's money in it."""
    pools = {}
    for name, _, balance, lever, short, usd_cad, fee in accounts:
        for sleeve, amount in (("CAD", balance - usd_cad), ("USD", usd_cad * (1 - fee))):
            if amount <= 0:
                continue
            p = pools.setdefault((sleeve, lever), {"cad": 0.0, "may_short": True, "accounts": {}})
            p["cad"] += amount
            p["may_short"] = p["may_short"] and short
            p["accounts"][name] = amount
    return pools


def book_settings(accounts, rates, margin="on", buying_power=0.0, collateral=(), rebalance="M", years=30, ruin=0.05,
                  inflation=0.02, ccy="CAD"):
    """(the Settings bundle, the rest a book needs) for a set of accounts: cupel's `configure`, with nothing global.

    `margin`: 'on' is the most the buying power lets the margin accounts borrow on day one, 'off' nothing, a number
    that many (of the book's currency) at most. `buying_power`: the margin accounts' stated purchasing power;
    `collateral`: the names of the accounts that back it. The rest: {pools, margin_cad, margin_share, accounts}.
    """
    accounts = list(accounts)
    if not accounts:
        raise CoreError("a book needs at least one account")
    if rebalance not in ("M", "Q", "Y", "none"):
        raise CoreError(f"rebalance is M, Q, Y or none, not {rebalance!r}")
    pools = pools_of(accounts)
    pool_keys = sorted(pools)                                  # [(sleeve, may_lever), ...]
    book_cad = sum(q["cad"] for q in pools.values())           # the accounts' total, after conversion
    pool_share = {k: pools[k]["cad"] / book_cad for k in pool_keys}   # the base, fully invested
    own = {a[0]: a[2] - a[5] for a in accounts}                # each account's own-currency money
    lever = {a[0] for a in accounts if a[3]}
    collateral = tuple(collateral)
    collateral_cad = sum(own[a] for a in collateral)
    buying_power_mult = buying_power / collateral_cad if collateral_cad > 0 else 0.0
    most = max(0.0, buying_power - sum(own[a] for a in lever)) if buying_power_mult else 0.0
    margin_cad = {"on": most, "off": 0.0}.get(margin, None)
    if margin_cad is None:
        margin_cad = min(float(margin), most)
    # the registered collateral's part of its pool (the pool's accounts hold the same mix)
    reg = pools.get(("CAD", False))
    collateral_in_pool = sum(own[a] for a in collateral if a not in lever) / reg["cad"] if reg else 0.0
    s = Settings(rebalance=rebalance, mc_years=years, mc_ruin=ruin, mc_inflation=inflation, pool_keys=pool_keys,
                 pool_share=pool_share, rates=rates, buying_power_mult=buying_power_mult,
                 collateral_in_pool=collateral_in_pool, book_cad=book_cad, ccy=ccy)
    return s, {"pools": pools, "margin_cad": margin_cad, "margin_share": margin_cad / book_cad, "accounts": accounts,
               "buying_power": buying_power, "collateral": collateral}


def pool_label(key):
    sleeve, lever = key
    return f"{sleeve} {'margin' if lever else 'registered'}"
