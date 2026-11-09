#!/usr/bin/env python3
"""Resolve a skill's layered customization block.

Merges, in order (later wins):

  1. <skill-root>/customize.toml                             defaults (DO NOT EDIT)
  2. .stellar-build/custom/<skill-name>.toml                 team overrides
  3. .stellar-build/custom/<skill-name>.user.toml            personal overrides

`<skill-name>` is the basename of the skill root directory. Missing layers are
skipped. Emits JSON on stdout.

Usage:
    python3 resolve_customization.py --skill /path/to/skill [--key agent]
                                     [--project-root PATH]

If --project-root is omitted it is inferred from this script's location
(<project-root>/.stellar-build/scripts/resolve_customization.py).
"""

from __future__ import annotations

import argparse
import json
import sys
import tomllib
from pathlib import Path

from merge import merge  # sibling module; see merge.py


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
    ap.add_argument("--skill", type=Path, required=True, help="skill root directory")
    ap.add_argument("--project-root", type=Path, default=None)
    ap.add_argument("--key", default=None, help="return only this top-level key")
    args = ap.parse_args()

    skill_root = args.skill.expanduser().resolve()
    if not skill_root.is_dir():
        print(f"error: --skill {skill_root} is not a directory", file=sys.stderr)
        return 1

    root = args.project_root or Path(__file__).resolve().parents[2]
    custom = root / ".stellar-build" / "custom"
    name = skill_root.name

    resolved: dict = {}
    for layer in (
        skill_root / "customize.toml",
        custom / f"{name}.toml",
        custom / f"{name}.user.toml",
    ):
        resolved = merge(resolved, load(layer))

    if not resolved:
        print(
            f"error: no customization found for skill {name!r} "
            f"(looked for {skill_root / 'customize.toml'})",
            file=sys.stderr,
        )
        return 1

    if args.key is not None:
        if args.key not in resolved:
            print(
                f"error: key {args.key!r} not present for skill {name!r} "
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
