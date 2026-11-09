#!/usr/bin/env node
/**
 * Verifies every colour pairing the Plina design system claims is legal.
 * Reads design-system/tokens.json so the doc can never drift from the tokens.
 *
 *   node design-system/check-contrast.mjs
 *
 * Exits non-zero if any pairing the system depends on falls below its threshold.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, 'tokens.json'), 'utf8'));

/** Resolves a token path to a hex string, following DTCG `{alias.path}` references. */
const hex = (path, seen = new Set()) => {
  if (seen.has(path)) throw new Error(`Circular token alias at ${path}`);
  seen.add(path);
  const node = path.split('.').reduce((o, k) => {
    if (o?.[k] === undefined) throw new Error(`Unknown token path: ${path}`);
    return o[k];
  }, tokens);
  const value = node.$value;
  const alias = typeof value === 'string' && value.match(/^\{(.+)\}$/);
  return alias ? hex(alias[1], seen) : value;
};

const luminance = (h) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const AA = 4.5;
const AA_LARGE = 3.0;

/** Every pairing the system actively relies on, with the rule that justifies it. */
const CONTRACTS = [
  // Body text on each surface
  ['color.surface.deep-petrol', 'color.surface.sheet-white', AA, 'body on sheet-white'],
  ['color.surface.deep-petrol', 'color.surface.document-grey', AA, 'body on document-grey'],
  ['color.surface.document-grey', 'color.surface.deep-petrol', AA, 'body on deep-petrol'],
  ['color.surface.document-grey', 'color.backdrop.abyss', AA, 'body on abyss'],

  // The Surface-Aware Cyan Rule — the step must match the surface
  ['color.signal.500', 'color.surface.deep-petrol', AA, 'signal.500 on deep-petrol'],
  ['color.signal.500', 'color.backdrop.abyss', AA, 'signal.500 on abyss'],
  ['color.signal.600', 'color.surface.sheet-white', AA, 'signal.600 on sheet-white'],
  ['color.signal.700', 'color.surface.sheet-white', AA, 'signal.700 on sheet-white'],
  ['color.signal.700', 'color.surface.document-grey', AA, 'signal.700 on document-grey'],

  // Text ON a cyan fill (TopBar, cyan CTA hover) — Deep Petrol, never white
  ['color.surface.deep-petrol', 'color.signal.500', AA, 'ink on a cyan fill'],

  // Support hues, dark surfaces only
  ['color.support.stellar-mid', 'color.surface.deep-petrol', AA, 'stellar-mid on deep-petrol'],
  ['color.support.glacier-tint', 'color.surface.deep-petrol', AA, 'glacier-tint on deep-petrol'],

  // Focus ring must clear 3:1 non-text contrast (WCAG 2.2 SC 1.4.11) on every surface it lands on
  ['color.state.focus-ring-on-light', 'color.surface.sheet-white', AA_LARGE, 'focus ring on sheet-white'],
  ['color.state.focus-ring-on-light', 'color.surface.document-grey', AA_LARGE, 'focus ring on document-grey'],
  ['color.state.focus-ring-on-dark', 'color.surface.deep-petrol', AA_LARGE, 'focus ring on deep-petrol'],
  ['color.state.focus-ring-on-dark', 'color.backdrop.abyss', AA_LARGE, 'focus ring on abyss'],

  // Error states
  ['color.state.danger', 'color.surface.sheet-white', AA, 'danger on sheet-white'],
  ['color.state.danger', 'color.surface.document-grey', AA, 'danger on document-grey'],
  ['color.state.danger-on-dark', 'color.surface.deep-petrol', AA, 'danger on deep-petrol'],
];

/** Pairings the system explicitly forbids. These MUST stay below AA. */
const FORBIDDEN = [
  ['color.surface.sheet-white', 'color.signal.500', 'white on cyan (use deep-petrol)'],
  ['color.signal.500', 'color.surface.sheet-white', 'signal.500 as ink on sheet-white'],
  ['color.signal.500', 'color.surface.document-grey', 'signal.500 as ink on document-grey'],
  ['color.signal.600', 'color.surface.document-grey', 'signal.600 as ink on document-grey'],
  ['color.support.stellar-mid', 'color.surface.sheet-white', 'stellar-mid as ink on light'],
  ['color.support.glacier-tint', 'color.surface.sheet-white', 'glacier-tint as ink on light'],
];

/** Non-text pairings the system forbids. These MUST stay below the 3:1 minimum. */
const FORBIDDEN_NON_TEXT = [
  ['color.signal.500', 'color.surface.sheet-white', 'signal.500 as focus ring on sheet-white'],
  ['color.signal.500', 'color.surface.document-grey', 'signal.500 as focus ring on document-grey'],
];

let failures = 0;

console.log('\nContracts — each pairing the system relies on:\n');
for (const [fg, bg, min, label] of CONTRACTS) {
  const r = ratio(hex(fg), hex(bg));
  const ok = r >= min;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)} (min ${min})  ${label}`);
}

console.log('\nGuards — each pairing the system forbids must stay below AA:\n');
for (const [fg, bg, label] of FORBIDDEN) {
  const r = ratio(hex(fg), hex(bg));
  const stillForbidden = r < AA;
  if (!stillForbidden) {
    failures++;
    console.log(`  STALE ${r.toFixed(2).padStart(5)}  ${label} now passes AA — the rule needs revisiting`);
  } else {
    console.log(`  OK    ${r.toFixed(2).padStart(5)}  ${label}`);
  }
}

for (const [fg, bg, label] of FORBIDDEN_NON_TEXT) {
  const r = ratio(hex(fg), hex(bg));
  if (r >= AA_LARGE) {
    failures++;
    console.log(`  STALE ${r.toFixed(2).padStart(5)}  ${label} now clears 3:1 — the rule needs revisiting`);
  } else {
    console.log(`  OK    ${r.toFixed(2).padStart(5)}  ${label}`);
  }
}

console.log(
  failures === 0
    ? '\nAll pairings hold. tokens.json and plina-design-system.md agree.\n'
    : `\n${failures} problem(s). Fix tokens.json or update the doctrine before shipping.\n`
);

process.exit(failures === 0 ? 0 : 1);
