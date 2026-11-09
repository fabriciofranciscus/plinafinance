#!/usr/bin/env python3
"""Resolve the layered stellar-build project config.

Merges, in order (later wins):

  1. .stellar-build/config.toml              installer base, team-scoped
  2. .stellar-build/config.user.toml         installer base, user-scoped
  3. .stellar-build/custom/config.toml       team overrides
  4. .stellar-build/custom/config.user.toml  personal overrides

Missing layers are skipped. Emits JSON on stdout.

Usage:
    python3 resolve_config.py [--project-root PATH] [--key KEY] [--format json|toml-ish]

If --project-root is omitted it is inferred from this script's location
(<project-root>/.stellar-build/scripts/resolve_config.py).
"""

from __future__ import annotations

import argparse
import json
import sys
import tomllib
from pathlib import Path

from merge import merge  # sibling module; see merge.py

LAYERS = (
    "config.toml",
    "config.user.toml",
    "custom/config.toml",
    "custom/config.user.toml",
)


def load(path: Path) -> dict:
    try:
        with path.open("rb") as fh:
            return tomllib.load(fh)
    except FileNotFoundError:
        return {}
    except tomllib.TOMLDecodeError as exc:
        print(f"error: {path} is not valid TOML: {exc}", file=sys.stderr)
        raise SystemExit(2)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--project-root", type=Path, default=None)
    ap.add_argument("--key", default=None, help="return only this top-level key")
    ap.add_argument("--format", default="json", choices=("json",))
    args = ap.parse_args()

    root = args.project_root or Path(__file__).resolve().parents[2]
    base = root / ".stellar-build"

    if not base.is_dir():
        print(f"error: {base} does not exist", file=sys.stderr)
        return 1

    resolved: dict = {}
    for rel in LAYERS:
        resolved = merge(resolved, load(base / rel))

    if args.key is not None:
        if args.key not in resolved:
            print(
                f"error: key {args.key!r} not present in resolved config "
                f"(available: {', '.join(sorted(resolved)) or 'none'})",
                file=sys.stderr,
            )
            return 1
        resolved = resolved[args.key]

    json.dump(resolved, sys.stdout, ensure_ascii=False, indent=2, sort_keys=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
