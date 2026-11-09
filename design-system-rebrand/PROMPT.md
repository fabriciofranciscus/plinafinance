# Plina Rebrand v2.0 (candidate) — compact spec

> Candidate system. The official one lives in `design-system/` and wins on existing surfaces.
> Use this only where the rebrand was explicitly requested.

**North star:** the verifiable prospectus. Dark reading surface, numbers as evidence, documentary
photography as proof of collateral, compliance as the headline.

## Colour — surface-aware, all ratios measured

```
DARK (default)   deep #0C1719 · raised #122224 (cards) · recess #0A1214 (announcement)
LIGHT (closing)  pale #EDF3F2 · sheet #ffffff (forms only)
SIGNAL           #0EA7C7 on dark · #046C88 on light — never swapped
SUPPORT          glacier #A0CFE7, dark only
INK on dark      #EDF3F2 · body α.65 · muted α.55 (floor) · faint α.25 decorative
INK on light     #132728 · body α.70 · muted α.65 (floor — α.60 fails AA)
ON A CYAN FILL   #132728 always. White on cyan is forbidden (2.85:1).
HAIRLINES        rgba(237,243,242, .08 section / .1 frame / .12 divider / .15 quiet button)
                 rgba(19,39,40, .12 light rule / .2 field border)
```

Cyan appears at most 3 times per viewport: metrics, the `Plina.` period, the announcement bar,
CTA hover, chip borders, focus rings. Never body text, never ink on light, never a big fill.
**No shadows exist in this system.** Hairlines are the only separator.

## Type — four families, disjoint jobs

```
Chillax 500/600   displays: h1 clamp(2.75rem,6.5vw,5.5rem) -0.03em · h2 clamp(2rem,4vw,3.25rem) -0.025em
Satoshi 400       body 1.0625rem / 1.65, secondary 0.9375rem, micro 0.8125rem — max 56ch
Geist 500/600     labels, step titles, buttons
Geist Mono        THE FACTS: eyebrows 0.75rem/0.18em/uppercase · every number · numerals 01–06
```

Two number sizes, and they mean different things:
`numeric-xl clamp(2.75rem,5vw,4.25rem)` **in cyan** = evidence about the operation (R$ 40bi, 2008).
`numeric-l clamp(2.5rem,4vw,3.5rem)` **in ink** = a product claim (CDI+5%). Never colour a claim cyan.

## Layout

```
container 1240px · photo 1100px · gutter clamp(24px,5vw,48px)
hero 9rem ↓ · section 7rem · metric band 6.5rem · footer 4.5rem
grids auto-fit: product 320 · media 300 · thesis 280 · metric 220
radius: 12px photos · 24px filled panels · 9999px buttons+chips · 0 on structure (tables, rows,
rules, underline fields). Source is brand_guidelines: "sem arestas, sem rigidez". Panels round more
than photos so a coloured panel never reads as another image.
breakpoints (obligatory): 560 collapse fixed grids · 760 step rows drop title column · 960 nav drawer
```

## Motion — one easing, four scroll grammars

`cubic-bezier(0.22,1,0.36,1)`, always.
**count** metrics 1400ms · **unmask** section h2 via clip-path 900ms · **rise** cards +26px stagger
90ms 750ms · **aperture** photos inset 10%→0 + scale 1.03→1, 1100ms. Fire once, threshold .12.
Hover moves colour and borders only (250ms) plus the accordion `+` rotation (300ms). Nothing
translates on hover. All of it off under reduced motion, with content left **visible**.

## Components

Eyebrow (mono, uppercase, .18em) opens **every** section · card = raised fill + hairline + radius 24,
order: heading+chips → number → data rows → link out · chip = pill outline, glacier or cyan, metadata
only · numbered accordion `<details>` `52px 1fr auto`, first open, `+` rotates 45°, body indents 68px ·
step row `52px 190px 1fr` collapsing at 760px · field on sheet, label above, focus border `#046C88` ·
navbar sticky `rgba(12,23,25,.85)` + blur, drawer below 960px · announcement bar = cyan fill, `#132728`
label · credential marquee: regulatory facts only, 40s, duplicate `aria-hidden`.

Photography is the motif: person / asset / market, documentary, wide, no text over it, no scrim,
`aperture` entrance only.

## Voice

Declarative, specific, the number carries the claim. Regulatory facts stated flatly. Every yield
claim carries its footnote in the same viewport. Eyebrows are nouns. No exclamation marks, no emoji,
no retail-fintech vocabulary.

## Before returning UI

Cyan ≤3 points and stepped per surface · text on cyan is `#132728` · alpha ≥.55 dark / ≥.65 light,
never crossed · zero shadows · radius ∈ {12 media, 24 panel, 9999 control, 0 structure} · numbers in mono · eyebrow on every section ·
every fixed grid has its collapse rule · nav has a drawer · reduced motion leaves content visible ·
run `node design-system-rebrand/check-contrast.mjs`.
