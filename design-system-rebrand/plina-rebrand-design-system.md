# Plina Rebrand — Design System v2.1 *(candidate)*

> **Status: CANDIDATE. Not official.**
> `design-system/plina-design-system.md` remains the authoritative system for every Plina surface
> until this one is officialised. Nothing in this document changes an existing product. Use it only
> where a surface has explicitly opted into the rebrand.
> Section 11 lists every point where the two systems disagree, and which one wins today.

**Derived from:** `Plina landing page nova/Plina Landing v3 - Rebrand.dc.html`
**Verified by:** `node design-system-rebrand/check-contrast.mjs` — every ratio in §3 is measured, not estimated.

---

## 0. How to use this document

This is the canonical spec: paste it whole into an LLM as project knowledge, and read it as a human.
Machine consumers take `tokens.json` (W3C DTCG). Plain projects take `tokens.css`. Tight context
windows take `PROMPT.md`.

Precedence **inside the rebrand**: `plina-rebrand-design-system.md` → `tokens.json` → `tokens.css`.
Precedence **against the rest of the repo**: the official `design-system/` wins, always, until §11
says otherwise.

---

## 1. What changed, and why

The official system was built for **the printed prospectus** — a light, paper-like surface where a
regulated instrument is described in ink. The rebrand keeps every regulatory commitment and moves the
argument to a different room.

> **North star: the verifiable prospectus.**
> A dark reading surface where the numbers are the evidence, the photograph is the collateral, and
> the compliance chain is the headline rather than the footnote.

Three convictions drive the change:

1. **Dark is the ground, not an accent.** The instrument is read at a desk, next to a terminal. The
   light surface survives only where the reader is asked to *act* — the FAQ and the lead capture.
2. **The number is the proof.** Monospace is promoted from detail to protagonist: it is the most-used
   family in the system. If a figure means something, it is set in Geist Mono.
3. **Real collateral is photographed.** The official system's ambient light blobs are abstraction.
   The rebrand replaces décor with documentary photography of the person, the asset and the market —
   because the whole thesis is that the backing is real.

### The reader

An institutional allocator: family office, asset manager, credit fund, corporate treasury. They have
seen a thousand fintech landing pages and discount all of them. They are looking for the reasons to
say no. Every screen must survive a risk desk reading it in bad faith.

---

## 2. The seven laws

1. **Dark first.** `surface.deep` is the page. Light surfaces appear at most twice, at the end.
2. **One elevation step.** `surface.raised` for cards, `surface.recess` for wells. Never a third.
3. **Hairlines separate. Nothing else does.** No shadows anywhere in the system, no exceptions.
4. **Every number is mono.** Geist Mono for figures, numerals, tickers, data rows. Satoshi never
   carries a meaningful number.
5. **Cyan is surface-aware and rationed.** `signal.500` on dark, `signal.700` on light, never
   swapped, never more than three visible points per viewport.
6. **Every section opens with an eyebrow.** Mono, uppercase, `0.18em`, muted. This is the system's
   metronome.
7. **Motion happens on scroll, not on hover.** Four scroll grammars (§9) carry the energy. Pointer
   feedback is limited to borders, colour and one rotating icon.

---

## 3. Colour

### The palette

| Token | Hex | Name | Role |
|---|---|---|---|
| `surface.deep` | `#0C1719` | Petrol Deep | The page. Default surface of the brand |
| `surface.raised` | `#122224` | Petrol Raised | Cards and panels on dark. The only elevation step |
| `surface.recess` | `#0A1214` | Petrol Recess | Announcement bar, inset wells |
| `surface.pale` | `#EDF3F2` | Mist White | Light surface — closing sections only |
| `surface.sheet` | `#ffffff` | Sheet White | Forms and cards on pale. Never a whole section |
| `signal.500` | `#0EA7C7` | Action Cyan | Ink on dark, and every cyan fill |
| `signal.700` | `#046C88` | — | The only cyan legal on a light surface |
| `support.glacier` | `#A0CFE7` | Detail Mist | Qualifier chips and secondary emphasis, dark only |
| `ink.on-light` | `#132728` | Base Plina | Inherited unchanged from the official system |

Petrol Deep is a **deliberate darkening** of Base Plina `#132728`. That one move is what makes the
whole alpha ink scale legal — see below.

### Contrast — measured, not eyeballed

Run `node design-system-rebrand/check-contrast.mjs` after touching any colour. Current results:

| Ink | on `deep` | on `raised` | on `recess` | on `pale` | on `sheet` |
|---|---|---|---|---|---|
| `ink.on-dark` `#EDF3F2` | **16.23** ✅ | **14.61** ✅ | **16.86** ✅ | — | — |
| `ink.on-dark-body` α.65 | **7.35** ✅ | **6.89** ✅ | **7.49** ✅ | — | — |
| `ink.on-dark-muted` α.55 | **5.59** ✅ | **5.33** ✅ | **5.65** ✅ | — | — |
| `ink.on-light` `#132728` | — | — | — | **13.87** ✅ | **15.57** ✅ |
| `ink.on-light-body` α.70 | — | — | — | **5.50** ✅ | **5.82** ✅ |
| `ink.on-light-muted` α.65 | — | — | — | **4.72** ✅ | **4.95** ✅ |
| `signal.500` `#0EA7C7` | **6.40** ✅ | **5.76** ✅ | **6.64** ✅ | 2.54 ❌ | 2.85 ❌ |
| `signal.700` `#046C88` | 3.04 ❌ | 2.74 ❌ | 3.16 ❌ | **5.34** ✅ | **5.99** ✅ |
| `support.glacier` `#A0CFE7` | **10.91** ✅ | **9.82** ✅ | **11.33** ✅ | 1.49 ❌ | 1.67 ❌ |
| `danger-on-dark` `#F2B8B5` | **10.67** ✅ | **9.61** ✅ | **11.08** ✅ | — | — |
| `danger` `#B3261E` | — | — | — | **5.82** ✅ | **6.54** ✅ |

**Text on an Action Cyan fill MUST be `#132728` (5.47:1). White on cyan is 2.85:1 and is forbidden** —
announcement bar, cyan chips, cyan CTA hover, all of them.

### The two ink floors

The alpha scales bottom out at different places, and the reason is structural:

```
On dark   → floor is 0.55 alpha   (5.33:1 even on the raised card)
On light  → floor is 0.65 alpha   (4.72:1 on pale; 0.60 fails at 4.06:1)
```

The deeper canvas buys three extra notches of transparency. That is the practical dividend of
Petrol Deep, and the reason muted copy on dark can be quieter than muted copy on light without
breaking. **Never carry a light-surface alpha over to dark, or the reverse.**

Below the floor, ink is `faint` and decorative: resting numerals, watermark figures. It may never
carry meaning.

### Decision rule for cyan

```
Cyan on deep / raised / recess?     → signal.500  #0EA7C7
Cyan on pale / sheet?               → signal.700  #046C88
Text sitting ON a cyan fill?        → ink.on-light #132728, always
Focus ring?                         → same rule: 500 on dark, 700 on light
```

`signal.500` is 2.54:1 on pale — it fails as ink **and** as a focus ring there (WCAG 2.2 SC 1.4.11
needs 3:1 for non-text). A themeable component that can land on either surface uses `signal.700`.

### Where cyan is allowed

Proof metrics · the logotype period (`Plina.`) · the announcement bar fill · CTA hover fill · chip
borders on `raised` · section links (`Conhecer a classe Sênior →`) · focus rings (surface-aware) ·
the accordion numeral on hover.
**Never** as body text, never on a light surface as ink, never as a large surface fill beyond the
announcement bar, never as a second decorative colour.

### Hairlines

The only structural separator. No shadows exist in this system.

| Token | Value | Use |
|---|---|---|
| `hairline.section` | `rgba(237,243,242,0.08)` | Between dark sections |
| `hairline.frame` | `rgba(237,243,242,0.1)` | Card border, rows inside a card |
| `hairline.divider` | `rgba(237,243,242,0.12)` | Rows in a list or accordion |
| `hairline.quiet` | `rgba(237,243,242,0.15)` | Quiet button at rest |
| `hairline.glacier` / `.signal` | `rgba(160,207,231,0.3)` / `rgba(14,167,199,0.45)` | Chip borders |
| `hairline.on-light` / `.field` | `rgba(19,39,40,0.12)` / `rgba(19,39,40,0.2)` | Light rules / input borders |

---

## 4. Typography

Four families, disjoint jobs. Mono is the largest presence in the system by count — that is intended.

| Role | Family | Weights | Job |
|---|---|---|---|
| Display | **Chillax** | 500, 600 | Headlines, and the credential marquee |
| Body | **Satoshi** | 400 | Prose. Set once on the root and inherited |
| Label | **Geist** | 500, 600 | Interface labels, step titles, buttons |
| **Fact** | **Geist Mono** | 300, 400, 500 | Eyebrows, every number, numerals, ticker data |

### Scale

| Token | Value | Use |
|---|---|---|
| `display-xl` | `clamp(2.75rem, 6.5vw, 5.5rem)` | h1. Once per page |
| `display-l` | `clamp(2rem, 4vw, 3.25rem)` | Section h2 |
| `numeric-xl` | `clamp(2.75rem, 5vw, 4.25rem)` | Proof metrics — cyan |
| `numeric-l` | `clamp(2.5rem, 4vw, 3.5rem)` | Product yields — ink, not cyan |
| `title-m` / `title-s` | `1.375rem` / `1.3125rem` | Card headings |
| `body-l` | `1.0625rem` | **Default body size** |
| `body-m` | `0.9375rem` | Card copy, accordion answers |
| `body-s` | `0.8125rem` | Announcement bar, footnotes, step rows |
| `label-m` / `label-s` / `label-xs` | `0.875` / `0.75` / `0.6875rem` | Labels, eyebrows, chips |

**The two number sizes are a hierarchy, not a preference.** `numeric-xl` in cyan is *evidence about
the operation* (R$ 40bi, 48 horas, 2008). `numeric-l` in ink is *a claim about the product*
(CDI + 5%, SOFR + 7%). Never colour a product claim cyan — it borrows credibility the number has not
earned.

### Tracking and leading

Displays track **negative** (`-0.03em` xl, `-0.025em` l). Mono tracks **positive**
(`0.18em` eyebrow, `0.14em` numeral, `0.1em` chip, `0.04em` data). Prose is `1.65`, compact rows
`1.6`, numbers `1`.

### Rules

- Body copy is capped at `56ch`; a lead paragraph at `46ch`; long descriptions at `66ch`, never past `76ch`.
- Display headings are capped at `22ch` — `15ch` for the h1. A headline that needs more words needs fewer words.
- Uppercase is only ever mono, and only at `label-s` or below.
- Never Satoshi for a meaningful number. Never Chillax below `1rem` except in the marquee.

---

## 5. Logotype

`Plina` in Chillax 600 with the period in `signal.500`. The period is the brand's smallest and most
repeated cyan. It appears in the navbar and once in the footer. Do not enlarge it, do not animate it,
do not use it as a bullet.

---

## 6. Elevation, depth and radius

### Radius: the brand has no edges

`brand_guidelines.html` describes the brand's visual motif in its own words:

> "Formas orgânicas e difusas... **sem arestas, sem rigidez**. Orgânico. Difuso. Sempre em fluxo."

`DESIGN.md` inverted that into "Corner Style: 0px (sharp). Esta é doutrina contra a estética SaaS",
and the official system inherited the inversion. **The guideline is the source and it wins.** A brand
whose display face is a rounded geometric sans cannot be set in hard-edged containers without the
geometry fighting the letterforms; that fight is what reads as brutal.

| Token | Value | Applies to |
|---|---|---|
| `radius.media` | `12px` | Photographs. Small enough to read as finish, not as a card |
| `radius.panel` | `24px` | A panel carrying a fill of its own |
| `radius.pill` | `9999px` | Buttons and chips |
| `radius.none` | `0` | Tables, accordion rows, section rules, underline-only fields |

**Panels are rounder than photographs, deliberately.** A coloured panel at the same radius as the
images beside it starts reading as another image. The two-step gap keeps them separate kinds of object.

**Structure has no radius; only objects do.** A table rule, an accordion row and a section hairline
are the document's skeleton, not things sitting on the page. Rounding them is a category error.

**A full-bleed photograph is the one place radius is optional.** Its corners land on the window edge,
where a radius reads as a rendering fault rather than as softness. Either keep it at `radius.media`
and accept the soft notch at the viewport corners, or inset the image into the container. Do not
give a full-bleed image a large radius.

### Elevation

Flat by doctrine, with exactly one step. Depth comes from three mechanisms, none of which is a shadow:

1. **Tonal step** — `recess` behind, `deep` at ground, `raised` for cards. One step in each direction.
2. **Hairlines** — a 1px border, or a rule between sections.
3. **Border reveal on hover** — a card's or link's border moves to `signal.500` over
   `250ms var(--plina-ease)`. No translate, no scale, no shadow spread.

**There is no shadow exception.** The official system allows one, on the primary lead CTA. The
rebrand removes it: on a dark surface a cyan glow reads as a web app, and the whole point of the
surface is that this is not one.

Glassmorphism is allowed in exactly one place: the sticky navbar, `rgba(12,23,25,0.85)` +
`backdrop-filter: blur(12px)`, for legibility over moving content. Never on a content card.

---

## 7. The motif: documentary photography

The official system's ambient light blobs are replaced by photographs. This is the single largest
visual change, and it is an argument, not a style: *the collateral is real, so show it.*

**The triptych.** Where the system needs to establish backing, it uses three photographs in one row:

1. **The person** — a real assignor, in the context of their work or of the asset they earned.
2. **The asset** — the property, the works, the fleet, in operation.
3. **The market** — a financial district, framed wide.

**Rules.**

- Photographs are **documentary**, never stock-optimistic: no handshakes, no laptops in cafés, no
  people pointing at charts. If it could illustrate an insurance ad, reject it.
- Wide framing with air. The hero photograph is capped at `container-media` `1100px` — narrower than
  the text container, so it reads as a plate inside the document rather than a banner behind it.
- Radius `media` `12px`. Heights are fluid: hero `clamp(260px, 42vw, 480px)`, triptych
  `clamp(240px, 30vw, 360px)`.
- No gradient scrim, no cyan duotone, no text laid over a photograph. If a caption is needed it sits
  beneath the frame.
- Photographs enter with the **aperture** grammar (§9) and nothing else.

---

## 8. Components

### Buttons

| Variant | Rest | Hover | Padding |
|---|---|---|---|
| **Primary (on dark)** | `bg` ink.on-dark · `text` surface.deep | `bg` signal.500 · `text` ink.on-signal | `15px 32px` |
| **Primary (on light)** | `bg` ink.on-light · `text` sheet | `bg` signal.500 · `text` ink.on-signal | `15px 32px` |
| **Quiet (on dark)** | transparent · 1px `hairline.quiet` · `text` ink.on-dark | `border` + `text` signal.500 | `13px 28px` |

Radius `pill`. Transition on colour and border only, `500ms var(--plina-ease)`. Never scale,
translate or shadow on hover. Focus: 2px ring, offset 3px, surface-aware.

### Chips

Pill, mono `label-xs`, tracking `0.1em`, padding `4px 12px`, 1px border, transparent fill. Two
variants: **glacier** (a neutral qualifier — "Investidor qualificado") and **signal** (a currency or
rail — "BRL · PIX", "USDC · EURC"). Metadata only. Never for navigation or selection.

### Card

`raised` fill, 1px `hairline.frame`, radius `panel`, padding `clamp(28px, 3.5vw, 44px)`. Contents in
this order: heading + chips → the number → data rows → the link out. Data rows separate with
`hairline.frame` and use `justify-content: space-between`. **Cards are never nested.**

### Data row

`space-between`, label in Geist `body-s` muted, value in Geist Mono `body-s` ink. Bottom hairline.
This is how paridade / duration / tíquete are expressed — never as a table.

### Metric tile

Mono `numeric-xl` in cyan, then a caption in `body-m` muted, capped at `32ch`. Animate with the
count grammar (§9). No icon, no trend arrow, no coloured background.

### Numbered accordion — the signature pattern

`<details>` with a `52px 1fr auto` summary grid: mono numeral, Geist 600 title, a `+` that rotates
45° over `300ms` when open. Body indents to `68px` (52 + 16) so it aligns with the title column, at
`body-m` muted, capped at `56ch`. Rows separate with `hairline.divider`. The first item opens by
default — the reader should see the shape of the answer without clicking.

Reach for this before inventing a card grid for anything that is *a list of commitments*.

### Step row

`52px 190px 1fr` — numeral, Geist 600 title, description. **Collapses to `52px 1fr` below the `lap`
breakpoint (760px), with the description moving to column 2.** Never let the description column
compress below `40ch`.

### Field

Label above in mono `label-xs`, field in Satoshi on `sheet`, **underline only**: no box, no radius,
a single `hairline.field` on the bottom edge, padding `0 0 12px`. Focus moves the border to `signal.700` and removes the outline on the
field itself. Errors: border and helper text in `danger`, helper in mono `body-s` — **never colour
alone**.

### Navigation

- **Announcement bar** — `signal.500` fill, `ink.on-signal` label, mono or Geist 500 `body-s`.
  Optional, one line, dismissible by prop.
- **Navbar** — sticky, `rgba(12,23,25,0.85)` + `blur(12px)`, 1px `hairline.section` beneath. Links in
  Geist `body-s` muted → `ink.on-dark` on hover. One CTA at the right.
- **Below `desk` (960px)** — a full-bleed `deep` drawer. **Hiding the links with no replacement is a
  defect, not a breakpoint.**

### Credential marquee

A single row of Chillax `body-l` muted credentials, duplicated and translated `-50%` over `40s`
linear, infinite, `overflow: hidden`, bled to the full viewport width. The duplicate is
`aria-hidden`. Pauses under reduced motion. Content is **regulatory facts only** — supervisors, laws,
rails, standards. Never partner logos, never adjectives.

---

## 9. Layout, breakpoints and motion

### Spacing and rhythm

```
container 1240px  ·  media 1100px  ·  gutter clamp(24px, 5vw, 48px)
hero 9rem ↓  ·  section 7rem  ·  metric band 6.5rem  ·  footer 4.5rem / 2.5rem
```

Grids, all `auto-fit`: product `minmax(320px, 1fr)` · media `minmax(300px, 1fr)` ·
thesis `minmax(280px, 1fr)` · metric `minmax(220px, 1fr)`.

### Breakpoints — three, and they are obligations

| Token | Width | What must happen |
|---|---|---|
| `palm` | 560px | Every fixed-column grid collapses to one content column |
| `lap` | 760px | Step rows drop their fixed title column (`52px 190px 1fr` → `52px 1fr`) |
| `desk` | 960px | The navbar becomes a drawer — not hidden links |

A fixed-column grid shipped without its collapse rule fails the §13 self-check.

### Motion — one easing, four grammars

`cubic-bezier(0.22, 1, 0.36, 1)`. Nothing else, ever.

| Grammar | Applies to | Behaviour |
|---|---|---|
| **count** | metrics | Cubic ease-out roll, `1400ms`. A year counts from a meaningful start, not from zero |
| **unmask** | the first h2 of each section | `clip-path: inset(0 0 100% 0)` → `inset(0 0 -20% 0)` + 18px rise, `900ms` |
| **rise** | cards, grid children, accordion rows | opacity + 26px translate, `750ms`, `90ms` stagger |
| **aperture** | photographs only | `inset(10% round 24px)` + `scale(1.03)` → `inset(0 round 16px)`, `1100ms` |

Observers fire at `threshold: 0.12`, `rootMargin: 0px 0px -8% 0px`, and unobserve after firing —
elements animate **once**. The hero plays `rise` on load with a `120ms` lead and `130ms` stagger.

Pointer motion is limited to: border colour `250ms`, background colour `250ms`, and the accordion
`+` rotation `300ms`. Nothing moves in space on hover.

**Everything above is disabled under `prefers-reduced-motion: reduce`,** and elements must be at
their final state — never left hidden.

### Accessibility floor

AA on all text (§3 table), 3:1 on focus rings and meaningful non-text, focus visible on every
interactive element, `<details>`/`<summary>` for accordions (not div+JS), one `h1` per page,
alt text on every photograph describing the collateral, not the mood.

---

## 10. Voice and copy

Unchanged from the official system, restated because the rebrand tempts a louder register.

- Declarative and specific. *"Bem-vindo ao crédito verificável."* not *"O futuro do crédito chegou."*
- The number carries the claim. If a sentence needs an adjective to be impressive, cut the sentence.
- Regulatory facts are stated flatly, never as reassurance: *"supervisionado pelo Banco Central desde
  2008"*, not *"totalmente regulamentado e seguro"*.
- Every yield claim carries its footnote in the same viewport. Metas indicativas, never promessa.
- Eyebrows are nouns: *Produto · Confiança · A tese · Como funciona*. Never verbs, never questions.
- No exclamation marks. No emoji. No retail-fintech vocabulary ("simples", "descomplicado",
  "sem burocracia").
- Portuguese is the source language; English is a translation of it, not a rewrite.

---

## 11. Reconciliations — where this disagrees with the official system

**Until this system is officialised, the official column wins on every existing Plina surface.**

| Topic | Official (`design-system/`) | Rebrand (this doc) | Note |
|---|---|---|---|
| Ground | Light-first: sheet white / document grey / deep petrol | **Dark-first**: deep / raised / recess, light only to close | The largest divergence |
| Surface count | Three, never a fourth | Five, in two families | Justified by §3's two ink floors |
| Base dark | `#132728` | `#0C1719` | Kept as `ink.on-light` for continuity |
| Light surface | `#e4e4e4` | `#EDF3F2` | Slightly cooler; both pass AA with `signal.700` |
| Radius | `0` or `9999px` | `12px` media / `24px` panel / `9999px` pill / `0` structure | The official rule contradicts `brand_guidelines.html`; the guideline wins (§6) |
| Easing | `cubic-bezier(0.16, 1, 0.3, 1)` | `cubic-bezier(0.22, 1, 0.36, 1)` | One easing each; do not mix |
| Card grids | Forbidden — use the numbered list | Allowed for products and thesis; numbered list kept for commitments | |
| Motif | Ambient light blobs | Documentary photography | §7 |
| Shadow | One exception (lead CTA hover) | **None** | Rebrand is stricter |
| Buttons | Pill, uppercase Geist 700, `20px 40px` | Pill, sentence case Geist 600, `17px 36px` | Rebrand keeps the pill and drops the uppercase |
| Mono | Numbers and page markers | Promoted to the dominant family | §4 |
| Breakpoints | Not specified | Three, obligatory | Fixes a real defect in v3 |

Unchanged and shared: the cyan steps and the surface-aware rule, `ink.on-signal`, hairlines as the
only separator, no glassmorphism on cards, Chillax / Satoshi / Geist / Geist Mono, the voice.

### Officialising this system

When the rebrand is approved, in this order: (1) run `check-contrast.mjs` green; (2) fold these
tokens into `design-system/tokens.json` under a v2 major; (3) update `AGENTS.md` to point at the new
canonical spec; (4) migrate `plina-landing.html` and the Next.js app; (5) delete this folder rather
than leaving two systems alive. **Two live design systems is the failure mode this separation exists
to avoid** — the split is temporary by construction.

---

## 12. Hard NO list

White text on cyan · cyan as ink on any light surface · `signal.500` as a focus ring on light ·
a light-surface alpha reused on dark or the reverse · any shadow · a gradient in text, background or
border · a sixth surface · nested cards · a hard-edged container around round display type · a rounded table rule or section hairline · a large radius on a full-bleed image · text laid over a photograph · a cyan duotone or scrim on a
photograph · stock-optimistic imagery · Satoshi for a meaningful number · Chillax below `1rem`
outside the marquee · uppercase in a non-mono family · a fixed-column grid with no collapse rule ·
hidden nav links with no drawer · a `<div>`-and-JS accordion · animation that leaves content hidden
under reduced motion · any easing other than `cubic-bezier(0.22, 1, 0.36, 1)` · emoji · exclamation
marks · a yield claim without its footnote in the same viewport.

---

## 13. Self-check before returning generated UI

1. Count the cyan. More than three visible points, or more than ~10% of the viewport? Cut it.
2. Every cyan foreground — did you take the step from §3 for that exact surface?
3. Any text on a cyan fill — is it `#132728`? Any focus ring on light — is it `#046C88`?
4. Any alpha ink — is it ≥ 0.55 on dark, ≥ 0.65 on light? Did you carry one scale onto the other?
5. Any shadow at all? Remove it.
6. Every radius — `12px` on media, `24px` on a filled panel, `9999px` on a control, `0` on structure? Is any panel the same radius as the photograph next to it?
7. Every meaningful number — Geist Mono? Is a product claim wrongly wearing metric cyan?
8. Every section — does it open with an eyebrow?
9. Every fixed-column grid — does it have its `palm` / `lap` collapse rule?
10. Does the nav have a drawer below 960px?
11. Every transition — `cubic-bezier(0.22,1,0.36,1)`, and does reduced motion leave content *visible*?
12. Body copy — Satoshi 400 at `1.0625rem`, capped at `56ch`?
13. Did you reach for a card grid where the numbered accordion was the right pattern?
14. Any photograph — documentary, no text over it, no scrim, alt text about the collateral?
15. Any copy with an exclamation mark, an emoji, or retail-fintech vocabulary?
16. Did you run `node design-system-rebrand/check-contrast.mjs` after touching a colour?
