"""pytest finds the core beside its tests (the core is a directory of cupel, not an installed package)."""
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
for p in (HERE, HERE.parent):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
