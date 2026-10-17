"""The settings a book is computed under, as one explicit bundle (OPPORTUNITY-PLAN-APPS.md A1: "no module
globals"). cupel's 4_book.py fills it from its own parameters; the user's application fills it from the accounts
the user entered and the release in hand (accounts.py)."""
import dataclasses


class CoreError(Exception):
    """Something the core was given that it cannot compute with, said in words a person can act on."""


# The simulation's constants are web/lib/montecarlo.js's, constant for constant (cupel's tests/test_montecarlo.py).
MC_PATHS, MC_BLOCK, MC_SEED, MC_BAND = 2000, 12, 20260923, 10
MC_YEARS_DEFAULT, MC_RUIN_DEFAULT, MC_INFLATION_DEFAULT = 30, 0.05, 0.02


@dataclasses.dataclass
class Settings:
    # how often each pool is put back to its weights: 'M', 'Q', 'Y' or 'none'
    rebalance: str = "M"
    # the withdrawal: years paid, the share of paths that may run out, the yearly rise of the withdrawal
    mc_years: int = MC_YEARS_DEFAULT
    mc_ruin: float = MC_RUIN_DEFAULT
    mc_inflation: float = MC_INFLATION_DEFAULT
    mc_seed: int = MC_SEED
    mc_paths: int = MC_PATHS
    mc_block: int = MC_BLOCK
    # the optimizer climbs the mean of the 2 x mc_band + 1 paths around the mc_ruin one
    mc_band: int = MC_BAND
    # the pools of money: [(sleeve, may_lever), ...] in order, and each one's share of the capital
    pool_keys: list = None
    pool_share: dict = None
    # sleeve -> {first day of month (numpy datetime64[D]) -> the margin loan's annual rate, a fraction}
    rates: dict = None
    # the margin accounts hold at most this multiple of (their equity + the collateral's value); 0: no borrowing
    buying_power_mult: float = 0.0
    # the registered collateral's part of the CAD registered pool
    collateral_in_pool: float = 0.0
    # the capital (the accounts' total), in `ccy`
    book_cad: float = None
    ccy: str = "CAD"
