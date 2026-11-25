#!/usr/bin/env node
/**
 * Verifies every colour pairing the Plina design system claims is legal.
 * Reads design-system/tokens.json so the doc can never drift from the tokens.
 *
 *   node design-system/check-contrast.mjs
 *   node design-system/check-contrast.mjs --scan app components   (report only)
 *   node design-system/check-contrast.mjs --scan app components --strict
 *
 * Translucent inks (rgba tokens, Tailwind `text-<colour>/<alpha>`) are composited over the surface before the
 * ratio is taken: an alpha colour has no contrast of its own, only the blended result has.
 *
 * Exits non-zero if any pairing the system depends on falls below its threshold. `--scan` lists class usages
 * below the opacity floor and only fails the run with `--strict`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

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

/** Parses `#rrggbb` or `rgb()/rgba()` into channels 0–255 plus alpha 0–1. */
const parse = (value) => {
  const h = /^#([0-9a-f]{6})$/i.exec(value);
  if (h) return { rgb: [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16)), a: 1 };
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (m) return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: m[4] === undefined ? 1 : Number(m[4]) };
  throw new Error(`Unsupported colour value: ${value}`);
};

/** Blends a (possibly translucent) foreground over an opaque background. `alpha` overrides the colour's own. */
const over = (fg, bg, alpha) => {
  const f = parse(fg);
  const b = parse(bg);
  if (b.a !== 1) throw new Error(`Background must be opaque: ${bg}`);
  const a = alpha ?? f.a;
  return f.rgb.map((c, i) => c * a + b.rgb[i] * (1 - a));
};

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Contrast of `fg` as actually rendered on `bg`; `alpha` simulates an opacity modifier on an opaque colour. */
const ratio = (fg, bg, alpha) => {
  const [x, y] = [luminance(over(fg, bg, alpha)), luminance(parse(bg).rgb)];
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

  // Translucent inks, measured as composited. These are the lowest alpha steps allowed for readable text.
  ['color.ink.on-light-muted', 'color.surface.sheet-white', AA, 'on-light-muted (70%) on sheet-white'],
  ['color.ink.on-light-muted', 'color.surface.document-grey', AA, 'on-light-muted (70%) on document-grey'],
  ['color.ink.on-dark-subtle', 'color.surface.deep-petrol', AA, 'on-dark-subtle (60%) on deep-petrol'],
  ['color.ink.on-dark-subtle', 'color.backdrop.abyss', AA, 'on-dark-subtle (60%) on abyss'],

  // Filled-button hover: the label must follow the fill
  ['color.surface.document-grey', 'color.signal.700', AA, 'off-white label on a signal.700 fill'],
  ['color.surface.sheet-white', 'color.signal.700', AA, 'white label on a signal.700 fill'],
];

/**
 * Opacity floors: the lowest alpha at which an ink is still readable text (AA) on its surfaces. Each entry is
 * [ink, alpha, surfaces]. The run fails if the floor does not pass, and flags it as stale if one step (10 points)
 * lower would also pass everywhere, so the floor never drifts from the tokens.
 */
const OPACITY_FLOORS = [
  ['color.surface.deep-petrol', 0.7, ['color.surface.sheet-white', 'color.surface.document-grey'], 'petrol ink on light'],
  ['color.surface.document-grey', 0.6, ['color.surface.deep-petrol', 'color.backdrop.abyss'], 'off-white ink on dark'],
];

/** Pairings the system explicitly forbids. These MUST stay below AA. */
const FORBIDDEN = [
  ['color.surface.sheet-white', 'color.signal.500', 'white on cyan (use deep-petrol)'],
  ['color.signal.500', 'color.surface.sheet-white', 'signal.500 as ink on sheet-white'],
  ['color.signal.500', 'color.surface.document-grey', 'signal.500 as ink on document-grey'],
  ['color.signal.600', 'color.surface.document-grey', 'signal.600 as ink on document-grey'],
  ['color.support.stellar-mid', 'color.surface.sheet-white', 'stellar-mid as ink on light'],
  ['color.support.glacier-tint', 'color.surface.sheet-white', 'glacier-tint as ink on light'],
  ['color.surface.document-grey', 'color.signal.500', 'off-white on cyan (use deep-petrol)'],
  ['color.surface.document-grey', 'color.signal.600', 'off-white label on a signal.600 fill (hover must be signal.700)'],
  ['color.ink.on-light-faint', 'color.surface.sheet-white', 'on-light-faint (20%) as text: decoration only'],
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

console.log('\nOpacity floors — lowest alpha that is still readable text:\n');
for (const [ink, alpha, surfaces, label] of OPACITY_FLOORS) {
  const at = (a) => Math.min(...surfaces.map((s) => ratio(hex(ink), hex(s), a)));
  const [floor, below] = [at(alpha), at(alpha - 0.1)];
  const pct = Math.round(alpha * 100);
  if (floor < AA) {
    failures++;
    console.log(`  FAIL  ${floor.toFixed(2).padStart(5)} (min ${AA})  ${label} at ${pct}%`);
  } else if (below >= AA) {
    failures++;
    console.log(`  STALE ${below.toFixed(2).padStart(5)}  ${label}: ${pct - 10}% now passes — lower the floor`);
  } else {
    console.log(`  PASS  ${floor.toFixed(2).padStart(5)} (min ${AA})  ${label} at ${pct}% (${pct - 10}% is ${below.toFixed(2)})`);
  }
}

/**
 * Source scan. Tailwind colour names used by the app, mapped to the token they carry and the surfaces they
 * are drawn on. The scan cannot see the real background, so it takes the worst legal surface for each ink.
 */
const SCAN_INKS = {
  base: ['color.surface.deep-petrol', ['color.surface.sheet-white', 'color.surface.document-grey']],
  lightBg: ['color.surface.document-grey', ['color.surface.deep-petrol', 'color.backdrop.abyss']],
  white: ['color.surface.sheet-white', ['color.surface.deep-petrol', 'color.backdrop.abyss']],
};
/** Class shapes that are never legal, whatever the alpha. */
const SCAN_PATTERNS = [
  [/(?:focus|focus-visible):(?:outline|ring|border)-primary\b(?!-)/g, 'signal.500 focus indicator: fails 3:1 on light surfaces, use signal-700 there'],
  [/(?<![:\w-])outline-primary\b(?!-)/g, 'signal.500 outline: fails 3:1 on light surfaces, use signal-700 there'],
];

const scanArg = process.argv.indexOf('--scan');
if (scanArg !== -1) {
  const strict = process.argv.includes('--strict');
  const roots = process.argv.slice(scanArg + 1).filter((a) => !a.startsWith('--'));
  if (roots.length === 0) throw new Error('--scan needs at least one directory');
  const files = [];
  const walk = (p) => {
    if (statSync(p).isDirectory()) {
      for (const e of readdirSync(p)) if (e !== 'node_modules' && e !== '__tests__' && !e.startsWith('.')) walk(join(p, e));
    } else if (/\.(tsx|jsx|ts|js|css|html)$/.test(p) && !/\.test\./.test(p)) files.push(p);
  };
  roots.forEach(walk);

  const hits = new Map();
  const add = (key, file) => {
    const h = hits.get(key) ?? { count: 0, files: new Set() };
    h.count++;
    h.files.add(relative(process.cwd(), file));
    hits.set(key, h);
  };
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const [, name, pct] of src.matchAll(/\btext-(base|lightBg|white)\/(\d{1,3})\b/g)) {
      const [ink, surfaces] = SCAN_INKS[name];
      const worst = Math.min(...surfaces.map((s) => ratio(hex(ink), hex(s), Number(pct) / 100)));
      if (worst < AA) add(`text-${name}/${pct}  ${worst.toFixed(2)}:1 worst case${worst >= AA_LARGE ? ' (large text only)' : ''}`, file);
    }
    for (const [re, why] of SCAN_PATTERNS) for (const m of src.matchAll(re)) add(`${m[0]}  ${why}`, file);
    // Filled-button hover: an off-white label on a signal-600 fill is 3.89:1. Same-line heuristic.
    for (const line of src.split('\n')) {
      if (/\btext-lightBg(?![\w/-])/.test(line) && /\bhover:bg-primary-deep\b/.test(line)) {
        add('text-lightBg + hover:bg-primary-deep  off-white on signal.600 is 3.89:1, hover fill must be signal-700', file);
      }
    }
  }

  console.log(`\nScan — ${files.length} files under ${roots.join(', ')}:\n`);
  const sorted = [...hits].sort((a, b) => b[1].count - a[1].count);
  for (const [key, h] of sorted) console.log(`  ${String(h.count).padStart(4)}×  in ${String(h.files.size).padStart(3)} file(s)  ${key}`);
  const total = sorted.reduce((n, [, h]) => n + h.count, 0);
  console.log(total === 0 ? '  No usage below the floor.' : `\n  ${total} usage(s) below the floor. The scan does not see the real background or font size: confirm in the browser.`);
  if (process.argv.includes('--files')) for (const [key, h] of sorted) console.log(`\n  ${key}\n    ${[...h.files].join('\n    ')}`);
  if (strict && total > 0) failures += total;
}

console.log(
  failures === 0
    ? '\nAll pairings hold. tokens.json and plina-design-system.md agree.\n'
    : `\n${failures} problem(s). Fix tokens.json or update the doctrine before shipping.\n`
);

process.exit(failures === 0 ? 0 : 1);
