#!/usr/bin/env node
/**
 * Verifies every colour pairing the Plina REBRAND design system claims is legal.
 * Reads design-system-rebrand/tokens.json so the doc can never drift from the tokens.
 *
 *   node design-system-rebrand/check-contrast.mjs
 *
 * Unlike the official checker, this one resolves alpha inks: an `rgba()` token is
 * composited over the background it is measured against before the ratio is taken.
 * The rebrand leans on alpha for its whole ink scale, so a checker that only
 * understood opaque hex would verify nothing that matters.
 *
 * Exits non-zero if any pairing the system depends on falls below its threshold.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, 'tokens.json'), 'utf8'));

/** Resolves a token path to its raw value, following DTCG `{alias.path}` references. */
const raw = (path, seen = new Set()) => {
  if (seen.has(path)) throw new Error(`Circular token alias at ${path}`);
  seen.add(path);
  const node = path.split('.').reduce((o, k) => {
    if (o?.[k] === undefined) throw new Error(`Unknown token path: ${path}`);
    return o[k];
  }, tokens);
  const value = node.$value;
  const alias = typeof value === 'string' && value.match(/^\{(.+)\}$/);
  return alias ? raw(alias[1], seen) : value;
};

/** `#rrggbb` or `rgba(r,g,b,a)` -> { r, g, b, a } in 0-255 / 0-1. */
const parse = (value) => {
  const rgba = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map((s) => s.trim());
    return { r: +r, g: +g, b: +b, a: +a };
  }
  const h = value.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: 1,
  };
};

/** Composites a possibly-translucent foreground over an opaque background. */
const flatten = (fg, bg) => ({
  r: fg.a * fg.r + (1 - fg.a) * bg.r,
  g: fg.a * fg.g + (1 - fg.a) * bg.g,
  b: fg.a * fg.b + (1 - fg.a) * bg.b,
  a: 1,
});

const luminance = ({ r, g, b }) => {
  const [R, G, B] = [r, g, b]
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};

/** Contrast of token `fg` read against opaque token `bg`, alpha composited. */
const ratio = (fgPath, bgPath) => {
  const bg = parse(raw(bgPath));
  if (bg.a !== 1) throw new Error(`Background ${bgPath} must be opaque`);
  const fg = flatten(parse(raw(fgPath)), bg);
  const [x, y] = [luminance(fg), luminance(bg)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const AA = 4.5;
const AA_LARGE = 3.0;
const NON_TEXT = 3.0;

const DARK = ['color.surface.deep', 'color.surface.raised', 'color.surface.recess'];
const LIGHT = ['color.surface.pale', 'color.surface.sheet'];

/** Every pairing the system actively relies on, with the rule that justifies it. */
const CONTRACTS = [
  // The ink scale must hold on EVERY dark surface, including the raised one.
  ...DARK.flatMap((s) => [
    ['color.ink.on-dark', s, AA, `ink.on-dark on ${s.split('.').pop()}`],
    ['color.ink.on-dark-body', s, AA, `ink.on-dark-body on ${s.split('.').pop()}`],
    ['color.ink.on-dark-muted', s, AA, `ink.on-dark-muted on ${s.split('.').pop()}`],
  ]),

  // And on every light surface.
  ...LIGHT.flatMap((s) => [
    ['color.ink.on-light', s, AA, `ink.on-light on ${s.split('.').pop()}`],
    ['color.ink.on-light-body', s, AA, `ink.on-light-body on ${s.split('.').pop()}`],
    ['color.ink.on-light-muted', s, AA, `ink.on-light-muted on ${s.split('.').pop()}`],
  ]),

  // Surface-aware cyan: 500 on dark, 700 on light. Never the other way round.
  ...DARK.map((s) => ['color.signal.500', s, AA, `signal.500 on ${s.split('.').pop()}`]),
  ...LIGHT.map((s) => ['color.signal.700', s, AA, `signal.700 on ${s.split('.').pop()}`]),

  // Text ON a cyan fill — Deep Petrol, never white.
  ['color.ink.on-signal', 'color.signal.500', AA, 'ink on a cyan fill'],

  // Glacier is dark-only support.
  ...DARK.map((s) => ['color.support.glacier', s, AA, `glacier on ${s.split('.').pop()}`]),

  // Focus rings must clear 3:1 non-text contrast (WCAG 2.2 SC 1.4.11) on their surface.
  ...DARK.map((s) => ['color.state.focus-on-dark', s, NON_TEXT, `focus ring on ${s.split('.').pop()}`]),
  ...LIGHT.map((s) => ['color.state.focus-on-light', s, NON_TEXT, `focus ring on ${s.split('.').pop()}`]),

  // Errors.
  ...LIGHT.map((s) => ['color.state.danger', s, AA, `danger on ${s.split('.').pop()}`]),
  ...DARK.map((s) => ['color.state.danger-on-dark', s, AA, `danger on ${s.split('.').pop()}`]),

  // Chip borders are non-text UI, but must still be visible against their card.
  ['color.hairline.glacier', 'color.surface.raised', 1.4, 'glacier chip border on a raised card'],
  ['color.hairline.signal', 'color.surface.raised', 1.4, 'cyan chip border on a raised card'],
];

/** Pairings the system explicitly forbids. These MUST stay below AA. */
const FORBIDDEN = [
  ['color.surface.sheet', 'color.signal.500', 'white on cyan (use ink.on-signal)'],
  ...LIGHT.map((s) => ['color.signal.500', s, `signal.500 as ink on ${s.split('.').pop()}`]),
  ...LIGHT.map((s) => ['color.support.glacier', s, `glacier as ink on ${s.split('.').pop()}`]),
  ...DARK.map((s) => ['color.signal.700', s, `signal.700 as ink on ${s.split('.').pop()}`]),
  ['color.ink.on-dark-faint', 'color.surface.deep', 'faint ink used as readable text'],
];

/** Non-text pairings the system forbids. These MUST stay below 3:1. */
const FORBIDDEN_NON_TEXT = [
  ...LIGHT.map((s) => ['color.signal.500', s, `signal.500 as focus ring on ${s.split('.').pop()}`]),
];

let failures = 0;

console.log('\nContracts — each pairing the system relies on:\n');
for (const [fg, bg, min, label] of CONTRACTS) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)} (min ${min})  ${label}`);
}

console.log('\nGuards — each pairing the system forbids must stay below AA:\n');
for (const [fg, bg, label] of FORBIDDEN) {
  const r = ratio(fg, bg);
  if (r >= AA) {
    failures++;
    console.log(`  STALE ${r.toFixed(2).padStart(5)}  ${label} now passes AA — the rule needs revisiting`);
  } else {
    console.log(`  OK    ${r.toFixed(2).padStart(5)}  ${label}`);
  }
}

for (const [fg, bg, label] of FORBIDDEN_NON_TEXT) {
  const r = ratio(fg, bg);
  if (r >= NON_TEXT) {
    failures++;
    console.log(`  STALE ${r.toFixed(2).padStart(5)}  ${label} now clears 3:1 — the rule needs revisiting`);
  } else {
    console.log(`  OK    ${r.toFixed(2).padStart(5)}  ${label}`);
  }
}

console.log(
  failures === 0
    ? '\nAll pairings hold. tokens.json and plina-rebrand-design-system.md agree.\n'
    : `\n${failures} problem(s). Fix tokens.json or update the doctrine before shipping.\n`
);

process.exit(failures === 0 ? 0 : 1);
