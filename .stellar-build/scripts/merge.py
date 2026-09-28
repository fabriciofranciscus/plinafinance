"""Structural merge rules shared by the stellar-build resolvers.

Rules (as documented in the BMAD skill activation blocks):

  * scalars                        -> override wins
  * tables (dicts)                 -> deep-merge
  * arrays of tables keyed by
    `code` or `id`                 -> matching entries are REPLACED in place,
                                      new entries are APPENDED
  * all other arrays               -> APPEND (base first, then override)

`merge` never mutates its arguments.
"""

from __future__ import annotations

from copy import deepcopy

KEY_FIELDS = ("code", "id")


def _key_field(rows: list) -> str | None:
    """Return the identity field if every row is a dict carrying it."""
    if not rows:
        return None
    for field in KEY_FIELDS:
        if all(isinstance(row, dict) and field in row for row in rows):
            return field
    return None


def _merge_keyed(base: list, override: list, field: str) -> list:
    out = [deepcopy(row) for row in base]
    index = {row[field]: i for i, row in enumerate(out)}
    for row in override:
        key = row[field]
        if key in index:
            out[index[key]] = merge(out[index[key]], row)
        else:
            index[key] = len(out)
            out.append(deepcopy(row))
    return out


def merge(base, override):
    if override is None:
        return deepcopy(base)
    if base is None:
        return deepcopy(override)

    if isinstance(base, dict) and isinstance(override, dict):
        out = deepcopy(base)
        for key, value in override.items():
            out[key] = merge(out[key], value) if key in out else deepcopy(value)
        return out

    if isinstance(base, list) and isinstance(override, list):
        field = _key_field(base) or _key_field(override)
        if field and all(isinstance(r, dict) and field in r for r in base + override):
            return _merge_keyed(base, override, field)
        return [deepcopy(r) for r in base] + [deepcopy(r) for r in override]

    # scalar, or a type change -> override wins
    return deepcopy(override)
