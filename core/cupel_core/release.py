"""A data release, read and checked (OPPORTUNITY-PLAN-APPS.md A3). cupel writes one with `py 4_book.py release`:
a manifest (its id, what it is as of, the rating method, and each part's name, size and SHA-256) and the parts,
Parquet files: `runs.parquet` (one row a run: what it is and its ratings), `equity/<from>-<to>.parquet` (each
run's daily equity, with its gross exposure and margin where the engine gave them), `fx.parquet` and
`margin_rate.parquet`.

The reader takes the manifest and a function that returns a part's bytes. It checks every part against the
manifest before reading it and refuses a release that fails: a book is never computed from data that is not the
data cupel published.
"""
import hashlib
import io

import numpy as np

from .settings import CoreError

FORMAT = 1


def check_part(manifest, part, data):
    """`data` if it is the part the manifest names (size and SHA-256); raises CoreError otherwise."""
    want = next((p for p in manifest.get("parts", []) if p["part"] == part), None)
    if want is None:
        raise CoreError(f"the release has no part {part!r}")
    data = bytes(data)
    if len(data) != want["bytes"]:
        raise CoreError(f"{part} is {len(data):,} bytes and the release says {want['bytes']:,}: not read")
    got = hashlib.sha256(data).hexdigest()
    if got != want["sha256"]:
        raise CoreError(f"{part} does not match the release's checksum ({got[:12]}... for {want['sha256'][:12]}...): not read")
    return data


def _table(data):
    import pyarrow.parquet as pq
    return pq.read_table(io.BytesIO(data))


def _days(col):
    return np.asarray(col.to_numpy(zero_copy_only=False), dtype="datetime64[D]")


class Release:
    """One release, held in memory: `runs` ({run_id: what it is}), each run's curve (`curve(run_id)`), `fx` and
    `rates` (the margin loan's rate by sleeve and month)."""

    def __init__(self, manifest, get_part):
        if manifest.get("format") != FORMAT:
            raise CoreError(f"this release is format {manifest.get('format')!r}; this version reads format {FORMAT}: "
                            f"a newer version of the application is needed")
        self.manifest = manifest
        self.as_of = manifest.get("as_of")
        self.rating_method = manifest.get("rating_method")
        names = [p["part"] for p in manifest["parts"]]
        for need in ("runs.parquet", "fx.parquet", "margin_rate.parquet"):
            if need not in names:
                raise CoreError(f"the release has no part {need!r}")
        read = lambda part: _table(check_part(manifest, part, get_part(part)))  # noqa: E731
        rows = read("runs.parquet").to_pylist()
        self.runs = {int(r["run_id"]): r for r in rows}
        self._curves = {}
        for part in names:
            if not part.startswith("equity/"):
                continue
            t = read(part)
            ids = np.asarray(t.column("run_id").to_numpy(zero_copy_only=False))
            days = _days(t.column("day"))
            eq = np.asarray(t.column("equity").to_numpy(zero_copy_only=False), dtype=float)
            margin = np.asarray(t.column("margin").to_numpy(zero_copy_only=False), dtype=float)
            # each run's rows are together, in day order (as written)
            cut = np.flatnonzero(np.r_[True, ids[1:] != ids[:-1], True])
            for a, b in zip(cut[:-1], cut[1:]):
                self._curves[int(ids[a])] = (days[a:b], eq[a:b], margin[a:b])
        missing = sorted(set(self.runs) - set(self._curves))
        if missing:
            raise CoreError(f"the release lists {len(missing)} runs with no equity (the first: {missing[:5]})")
        t = read("fx.parquet")
        self.fx_days = _days(t.column("day"))
        self.fx_vals = np.asarray(t.column("cad_per_usd").to_numpy(zero_copy_only=False), dtype=float)
        t = read("margin_rate.parquet")
        self.rates = {}
        for month, sleeve, rate in zip(_days(t.column("month")), t.column("sleeve").to_pylist(),
                                       t.column("rate").to_pylist()):
            self.rates.setdefault(sleeve, {})[month] = float(rate) / 100

    def curve(self, run_id):
        """(days, equity, margin) of a run; raises CoreError for a run the release does not hold."""
        if run_id not in self._curves:
            raise CoreError(f"run {run_id} is not in this release (as of {self.as_of})")
        return self._curves[run_id]

    def catalogue(self):
        """The runs as rows a screen can list: every field of runs.parquet that is a plain value."""
        out = []
        for rid in sorted(self.runs):
            r = self.runs[rid]
            out.append({k: (v if isinstance(v, (int, float, str, bool)) or v is None else str(v)) for k, v in r.items()})
        return out
