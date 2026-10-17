"""Validate sample/manifest.json and sample/reference.json against release-schema.json
using jsonschema's Draft202012Validator.  Exits 0 on success, 1 with error details on failure.
Run from the repo root: python -I tests/validate-schema.py
"""
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

root = Path(__file__).resolve().parent.parent
schema = json.loads((root / "release-schema.json").read_text())

def validate(label, instance, ref):
    wrapper = {"$schema": schema["$schema"], "$defs": schema["$defs"], "$ref": ref}
    v = Draft202012Validator(wrapper)
    errors = sorted(v.iter_errors(instance), key=lambda e: e.json_path)
    if errors:
        print(f"FAIL {label}")
        for e in errors:
            print(f"  {e.json_path}: {e.message}")
        return False
    print(f"OK   {label}")
    return True

ok = True
ok &= validate(
    "sample/manifest.json against Manifest schema",
    json.loads((root / "sample" / "manifest.json").read_text()),
    "#/$defs/Manifest",
)
ok &= validate(
    "sample/reference.json against ReferenceJson schema",
    json.loads((root / "sample" / "reference.json").read_text()),
    "#/$defs/ReferenceJson",
)

sys.exit(0 if ok else 1)
