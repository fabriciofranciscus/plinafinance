# Plina Finance — Design System v1.1

> **Machine-readable companion:** `tokens.json` (W3C DTCG). **Drop-in CSS:** `tokens.css`.
> **Compact version for tight context windows:** `PROMPT.md`.
> **Source of authority:** `docs/brand_guidelines.html` (Identity & Visual Guidelines v1.0).
>
> This file is written to be pasted whole into an LLM (Claude, ChatGPT, Cursor, v0, Lovable,
> Bolt) as project knowledge. It is self-contained: an agent that has only this file should be
> able to produce on-brand Plina UI in any stack without asking follow-up questions.

---

## 0. How to use this document

**If you are an LLM generating UI for Plina:** treat every rule marked **MUST** / **NEVER** as
non-negotiable. When a request conflicts with a MUST, satisfy the request in a way that keeps the
rule, and say which rule constrained you. When a decision is not covered here, choose the option
that a regulated financial institution would ship, not the option a SaaS landing page would ship.

**Precedence when sources disagree:** this file → `tokens.json` → `docs/brand_guidelines.html` →
`DESIGN.md`. Section 11 lists the conflicts that were resolved and how.

---

## 1. Who Plina is

Plina is an **institutional tokenizer of Brazilian consortium credit rights**. It is not a wallet,
not a peer-to-peer marketplace, not a neobank. It is the financial instrument itself — structured
as a **FIDC under CVM 175** and represented on-chain as a **Stellar** asset.

- **Mission.** Connect global institutional capital to the Brazilian credit-rights market through
  regulated Stellar infrastructure.
- **Vision.** Establish **PLINA-RF** as the institutional standard for tokenizing contemplated
  consortium quotas inside a FIDC.
- **Tagline.** *"Conectando o capital global ao mercado brasileiro de direito creditório."*
- **Product.** PLINA-RF — a tokenized pool of contemplated consortium quotas. 1 PLINA-RF = R$ 1.00
  of credit rights, marked daily to NAV. Senior and subordinated classes absorb losses in order.
- **On-chain compliance.** `AUTH_REQUIRED` · `AUTH_REVOCABLE` · `AUTH_CLAWBACK_ENABLED`.
- **Settlement.** USDC · EURC · BRZ · BRLA.

### The reader you are designing for

A **family-office risk desk in Miami, Singapore or London, at 2pm.** They must understand within
30 seconds that this is a formal regulated vehicle — not "digital fixed income" repackaged, and not
crypto-degen RWA with a press release. Four personas consume the product:

| Persona | Need | Scale |
|---|---|---|
| Vendedor (contemplated holder) | Liquidity, Pix in 48h | Individual |
| Comprador-usuário do bem | Discounted quota for a real asset (property, vehicle, equipment) | Individual |
| Investidor institucional BR | Senior/subordinated exposure | R$ 500k–10M |
| Investidor internacional | LATAM credit exposure via USDC/EURC | US$ 100k–5M |

### Creative north star: **"The Regulated Terminal"**

The register of an institutional financial terminal — *not* the trader terminal (Bloomberg, neon on
black), but the **regulated** terminal: hairlines as structural mesh, mono numerals carrying the data
that matters, editorial Chillax signing each section anchor, and a single auditable cyan that appears
rarely as **signal**, never as decoration. The one softness allowed is the ambient light-blob motif
(§7), and it lives only in the dark.

---

## 2. The seven laws

These are the rules that make output recognisably Plina. If you remember nothing else, remember these.

1. **The One Voice Rule.** Cyan occupies **≤10% of any viewport**. More than three visible cyan
   points on a screen means it is wrong. The signal's power is its rarity.
2. **The Three-Surface Sandwich.** Every page alternates between exactly three surfaces —
   Sheet White, Document Grey, Deep Petrol. **NEVER** a fourth content surface.
3. **The Surface-Aware Cyan Rule.** Cyan changes step depending on what it sits on. §3 has the table.
   Getting this wrong is an accessibility failure, not a taste failure.
4. **Flat by Doctrine.** No drop shadows on surfaces at rest. Depth is tonal and hairline-based.
   Exactly one shadow exists in the whole system (§6).
5. **Borders are 0 or 9999px.** Cards, tiles and panels are sharp. Buttons, chips and inputs are pills.
   **NEVER** anything in between in product UI.
6. **The Mono-For-Data Rule.** Every number carrying regulatory, financial or technical meaning is
   Geist Mono. This is the visual signature of the system.
7. **The Eyebrow-Headline Pair.** Every section opens with an uppercase cyan eyebrow label
   immediately followed by a Chillax display. **NEVER** a display heading alone.

---

## 3. Colour

### The palette

| Token | Hex | Brand name | Role |
|---|---|---|---|
| `surface.sheet-white` | `#ffffff` | Sheet White | Primary light surface |
| `surface.document-grey` | `#e4e4e4` | Off-White | Alternate light surface; input and chip fill |
| `surface.deep-petrol` | `#132728` | Base Plina | Dark surface **and** the dominant text colour on light |
| `backdrop.abyss` | `#080f10` | — | Décor canvas for the blob motif. Not a content surface (§7) |
| `signal.500` | `#0EA7C7` | Action Cyan | The signal. Dark surfaces and fills only |
| `signal.600` | `#057A99` | — | Cyan ink on Sheet White only |
| `signal.700` | `#046C88` | — | Cyan ink safe on **both** light surfaces |
| `support.stellar-mid` | `#4A9ED4` | Support Blue | Hover of heavy numerals, dark only |
| `support.glacier-tint` | `#A0CFE7` | Detail Mist | Secondary copy and title hover, dark only |

The palette is cold and deep — it communicates institutional stability, punctuated by the vibrant
cyan that marks opportunity and technical execution.

### Contrast table — the part that is most often got wrong

All ratios measured. **MUST** pick from this table rather than eyeballing.

| Foreground | on Sheet White | on Document Grey | on Deep Petrol | on Abyss |
|---|---|---|---|---|
| Deep Petrol `#132728` | **15.57** ✅ | **12.25** ✅ | — | 1.24 ❌ |
| Off-White `#e4e4e4` | 1.27 ❌ | — | **12.25** ✅ | **15.21** ✅ |
| Action Cyan `#0EA7C7` | 2.85 ❌ | 2.24 ❌ | **5.47** ✅ | **6.79** ✅ |
| Cyan 600 `#057A99` | **4.94** ✅ | 3.89 ❌ | 3.15 ⚠️ large | 3.91 ⚠️ large |
| Cyan 700 `#046C88` | **5.99** ✅ | **4.71** ✅ | 2.60 ❌ | 2.72 ❌ |
| Support Blue `#4A9ED4` | 2.94 ❌ | 2.32 ❌ | **5.29** ✅ | **6.57** ✅ |
| Detail Mist `#A0CFE7` | 1.67 ❌ | 1.31 ❌ | **9.32** ✅ | **11.58** ✅ |

**Text on an Action Cyan fill MUST be Deep Petrol (5.47:1). White on cyan is 2.85:1 and is
forbidden** — this includes the announcement TopBar, cyan badges, and cyan buttons.

### Decision rule for cyan ink

```
Is the cyan on a dark surface (deep-petrol or abyss)?
  → signal.500 #0EA7C7
Is it on sheet-white, and you are certain the surface will never change?
  → signal.600 #057A99
Anything else on light — document-grey, unknown surface, themeable component?
  → signal.700 #046C88     ← safe default
Is it text sitting ON a cyan fill?
  → surface.deep-petrol #132728, always
Is it a focus ring?
  → same rule: signal.500 on dark, signal.700 on light (see below)
```

**Focus rings are surface-aware too.** WCAG 2.2 SC 1.4.11 requires 3:1 for non-text indicators.
Action Cyan is only 2.85:1 on Sheet White and 2.24:1 on Document Grey, so it **MUST NOT** be the
focus ring on a light surface. Use `signal.700 #046C88` on light (5.99:1 / 4.71:1) and
`signal.500 #0EA7C7` on dark (5.47:1 / 6.79:1).

### Ink tokens

| Context | Colour |
|---|---|
| Body on light | Deep Petrol |
| Secondary on light | `rgba(19,39,40,0.7)` — do not go below 0.6 for readable text |
| Decorative numerals on light | `rgba(19,39,40,0.2)` — rest state only, never readable text |
| Body on dark | Off-White `#e4e4e4` (preferred over pure white for long copy) |
| Secondary on dark | Detail Mist `#A0CFE7` |
| On a cyan fill | Deep Petrol |

### Hairlines

The **only** structural separator. `1px rgba(19,39,40,0.12)` on light, `1px rgba(255,255,255,0.10)`
on dark, `1px rgba(160,207,231,0.10)` for outer frames of dark panels. **NEVER** a coloured border
for separation.

### Where cyan is allowed to appear

Active underlines · the logotype period (`Plina.`) · numbered markers (`01 //`) · eyebrow labels ·
the animated hover bar · TopBar fill · CTA hover fill · focus rings (surface-aware step) ·
the ambient blob motif.
**NEVER** as a large surface fill, as body text, or as a second decorative colour.

---

## 4. Typography

| Role | Family | Source |
|---|---|---|
| Display / headline / title / logotype | **Chillax** (fallback Satoshi) | Fontshare |
| Body | **Satoshi** | Fontshare |
| Labels, eyebrows, buttons | **Geist** | Google Fonts |
| Data | **Geist Mono** | Google Fonts |

```html
<link href="https://api.fontshare.com/v2/css?f[]=chillax@400,500,600,700&f[]=satoshi@300,400,500,700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@300;400;500&display=swap" rel="stylesheet">
```

Chillax signs the editorial anchors at weight 600 with tight leading — the institutional voice.
Satoshi carries long reading at weight 300, a deliberate contrast against the display weight.
Geist Mono is where the data lives. This pairing avoids the category reflex (Inter/Söhne everywhere)
in favour of an editorial-financial register.

### Scale

| Style | Font | Weight | Size | Leading | Tracking | Use |
|---|---|---|---|---|---|---|
| `display` | Chillax | 600 | `clamp(2rem, 5vw, 3.75rem)` | 1.05 | −0.02em | Hero H1, section anchors |
| `headline` | Chillax | 600 | `clamp(1.875rem, 3.5vw, 3rem)` | 1.1 | −0.015em | Titles inside a section |
| `title` | Chillax | 600 | 1.5rem | 1.2 | −0.01em | List items, tile titles |
| `body-lead` | Satoshi | 300 | 1.25rem | 1.6 | 0 | Opening paragraph |
| `body` | Satoshi | 300 | 1.125rem | 1.6 | 0 | Institutional copy |
| `body-small` | Satoshi | 400 | 0.875rem | 1.6 | 0 | Captions, table cells |
| `eyebrow` | Geist | 700 | 0.625rem | 1.4 | 0.2em UPPER | Section opener, in cyan |
| `eyebrow-wide` | Geist | 700 | 0.625rem | 1.4 | 0.4em UPPER | Hero and cover variant |
| `label` | Geist | 700 | 0.6875rem | 1.4 | 0.2em UPPER | Nav, buttons, chips, footer |
| `data` | Geist Mono | 500 | 0.875rem | 1.4 | 0.05em | Numbers that mean something |
| `data-micro` | Geist Mono | 400 | 0.75rem | 1.4 | 0.2em UPPER | Chrome: page markers, counters |

### Typography rules

- **The Light-Body Rule.** Body copy is Satoshi **300**. Weights 400+ in long copy read as heavy SaaS.
  The system breathes because body is light and display is medium-heavy.
- **The Mono-For-Data Rule.** Mono is **mandatory** for: target mixes (`40-60%`), durations
  (`30-90 dias`), percentages, NAV figures, AUM thresholds, SEP identifiers (`SEP-24`, `SEP-38`),
  Stellar flags (`AUTH_CLAWBACK_ENABLED`), on-chain hashes and addresses, ticker `PLINA-RF`,
  and `contato@plina.finance`. **NEVER** set these in Satoshi.
- **Measure.** Body copy caps at 70ch, hard limit 75ch.
- **Uppercase is a rule for every label.** No sentence-case labels.

---

## 5. Logotype

The wordmark is **`Plina`** in Chillax 600 with a **period in cyan**. The period is the mark — it
signifies the end of bureaucracy. It is never omitted, never a different colour, never animated.

```html
<!-- on dark -->
<span class="font-display font-semibold text-[#e4e4e4]">Plina<span class="text-[#0EA7C7]">.</span></span>
<!-- on light -->
<span class="font-display font-semibold text-[#132728]">Plina<span class="text-[#046C88]">.</span></span>
```

- On light surfaces the body of the wordmark takes **Base Plina `#132728`**, and the period takes the
  surface-appropriate cyan step (§3).
- The product ticker is written **`PLINA-RF`** in Geist Mono, uppercase, never in Chillax.
- Clear space around the wordmark: at least the cap-height of the `P` on every side.
- **NEVER** place the wordmark on a cyan fill, inside a box, on a photograph without a Deep Petrol
  scrim, or with a drop shadow.

---

## 6. Elevation and depth

Flat by doctrine. Depth comes from exactly three mechanisms, none of which is a shadow:

1. **Tonal sandwich** — alternation between Sheet White / Document Grey / Deep Petrol across sections.
2. **Hairlines** — `gap-px` over a hairline background, or a 1px hairline border.
3. **Colour reveal on hover** — a 1px × 100% cyan bar pinned left that scales `scale-y-0 → scale-y-100`
   from `origin-top`. Vertical only: no `translate-y`, no shadow spread, no scale on the card.

**The single shadow exception.** The one primary lead-capture CTA per page may take
`0 20px 25px -5px rgba(14,167,199,0.2)` **on hover only**. Nothing else in the system casts a shadow.

**No glassmorphism**, with one exception: the sticky navbar once it passes the hero, which may use
`backdrop-blur` for legibility over moving content. Never on content cards.

---

## 7. The visual motif: Ambient Light Blobs

> *Organic, diffuse forms of cyan luminosity emerging from darkness — no edges, no rigidity. The
> visual metaphor for liquidity and capital in continuous motion.*
> **Orgânico. Difuso. Sempre em fluxo.**

This is the brand's one piece of softness and its most recognisable art direction. It is **décor**.

### Where it is legal

✅ Hero panels · cover slides · full-bleed dark section backdrops · the closing panel.
❌ Light surfaces · behind or inside a content card · behind body copy at strength · anything
interactive · anything that would push cyan past the 10% viewport budget.

### The recipe

Layer three to four absolutely-positioned ellipses on an Abyss `#080f10` or Deep Petrol canvas,
each `border-radius: 50%`, blurred, at descending opacity, anchored off the panel edges.

```css
.blob        { position: absolute; border-radius: 50%; pointer-events: none; z-index: 1; }
.blob-primary   { width: 480px; height: 480px; filter: blur(40px);
  background: radial-gradient(ellipse at center, rgba(14,167,199,.22) 0%, rgba(14,167,199,.06) 45%, transparent 70%); }
.blob-secondary { width: 320px; height: 520px; filter: blur(50px);
  background: radial-gradient(ellipse at center, rgba(14,167,199,.13) 0%, transparent 65%); }
.blob-support   { width: 200px; height: 380px; filter: blur(45px);
  background: radial-gradient(ellipse at center, rgba(74,158,212,.10) 0%, transparent 60%); }
.blob-whisper   { width: 160px; height: 300px; filter: blur(55px);
  background: radial-gradient(ellipse at center, rgba(14,167,199,.07) 0%, transparent 60%); }
```

Composition guidance: cluster the two strongest blobs toward one corner, let one bleed off-canvas,
and keep the fourth as a distant whisper on the opposite side. Asymmetry is the point — never a
symmetric pair, never centred behind a headline.

### Fractal glass overlay

A ribbed-glass texture for cover art and full-bleed hero imagery only.

```css
.fractal-overlay {
  position: absolute; inset: 0; z-index: 5; pointer-events: none;
  backdrop-filter: blur(24px);
  background-image: repeating-linear-gradient(90deg,
    rgba(0,0,0,.3) 0px, rgba(255,255,255,.02) 1px,
    rgba(255,255,255,.005) 12px, rgba(0,0,0,.3) 13px);
  mix-blend-mode: overlay;
}
```

**NEVER** run this over readable text at full strength, and never on a content card.

### Legacy glow orb

A single solid cyan circle at `opacity: .15`, `filter: blur(100px)`, 500–800px, anchored off a panel
corner. Maximum **one** per viewport. Prefer the blob set above for new work.

---

## 8. Components

### Buttons

Full-radius pill, uppercase Geist 700 label with wide tracking. The feel is a wealth manager's
button, not a SaaS landing button.

| Variant | Rest | Hover | Padding |
|---|---|---|---|
| **Primary** | `bg` Deep Petrol · `text` Sheet White | `bg` Action Cyan · `text` **Deep Petrol** | `20px 40px` |
| **Ghost** | `bg` Sheet White · `text` Deep Petrol | `bg` Document Grey | `10px 20px` |
| **Quiet (on dark)** | transparent · 1px dark hairline · `text` Off-White | `border` Action Cyan · `text` Action Cyan | `10px 20px` |

Transition: `300ms cubic-bezier(0.16,1,0.3,1)` on colour only. **NEVER** scale, translate or shadow
on hover (except the single lead-capture CTA, §6). Focus: 2px ring at `outline-offset: 4px`, in
`#046C88` on light surfaces and `#0EA7C7` on dark.

```html
<!-- on a light surface -->
<button class="rounded-full bg-[#132728] px-10 py-5 font-label text-[0.625rem] uppercase tracking-[0.2em]
               text-white transition-colors duration-300 ease-[cubic-bezier(.16,1,.3,1)]
               hover:bg-[#0EA7C7] hover:text-[#132728]
               focus-visible:outline-2 focus-visible:outline-[#046C88] focus-visible:outline-offset-4">
  Solicitar Prospecto
</button>
```

### Inputs and fields

Pill (`9999px`), padding `16px 28px`, fill `rgba(228,228,228,0.2)`, 1px hairline border, Satoshi 400
at 1rem. Label sits **above** the field in Geist 700 uppercase `0.625rem` tracking `0.2em`, indented
`16px` to align with the pill's optical edge. Focus changes the border to Action Cyan — no glow, no
outline ring on the field itself. Error state: border and helper text in `#B3261E`, helper text in
Geist Mono `0.75rem`; **never** communicate error by colour alone — always include the helper text.

### Chips

Pill, `bg` Document Grey, `text` Deep Petrol at 60% alpha, Geist 700 `0.625rem` uppercase tracking
`0.2em`, padding `8px 16px`, hairline border. For **metadata only** ("Fluxo B2B Integrado",
"CVM 175 Compliant"). **NEVER** use chips for navigation or selection.

### Cards and tiles

- **Radius `0`.** Sharp. This is doctrine against the SaaS aesthetic.
- **Background** Sheet White over a Document Grey section, or vice versa.
- **Separation** via `gap-px` over a hairline background — the grid reveals the hairline beneath.
  Not an outer border on each card.
- **Padding** `32px`.
- **Shadow** none. **Hover** a fill transition over `500ms`; no translate, no scale.
- Cards are **never nested**.

### Data tile

The institutional stat block. Label in Geist uppercase, value in **Geist Mono**, optional caption in
Satoshi 300. No icon, no coloured background, no trend arrow unless the number is genuinely a series.

```html
<div class="bg-white p-8">
  <span class="font-label text-[0.625rem] uppercase tracking-[0.2em] text-[#046C88]">Duration alvo</span>
  <p class="mt-3 font-mono text-3xl font-medium tracking-[0.05em] text-[#132728]">30-90 dias</p>
  <p class="mt-2 max-w-[65ch] text-sm font-light text-[#132728]/70">Prazo médio ponderado da carteira.</p>
</div>
```

### Navigation

- **TopBar** — Action Cyan fill, Deep Petrol uppercase Geist label (never white text on cyan).
- **Navbar** — transparent over the hero, transitioning to `Deep Petrol/95` + `backdrop-blur-md`
  once scrolled past it. Items in Geist `0.6875rem` uppercase `tracking-[0.2em]`, `text-white/80` at
  rest → `text-white` on hover. No underline, no border-bottom.
- **Mobile** — hamburger + full-bleed Deep Petrol drawer, labels at `text-sm`.

### Chrome (decks, full-bleed panels)

- **Brand tag** — the logotype at 18px, pinned top-left at the gutter.
- **Page marker** — Geist Mono `12px`, `tracking-[0.2em]`, `rgba(160,207,231,0.4)`, pinned
  bottom-right: `01 // COVER`, `03 // PRODUCT`.

### Numbered list item — **the signature pattern**

Reuse this before inventing a card grid. Recurring in Princípios, Tese and Equipe.

```html
<div class="group relative border-b border-[rgba(19,39,40,0.12)] py-16">
  <span class="absolute left-0 top-0 h-full w-px origin-top scale-y-0 bg-[#0EA7C7]
               transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-y-100"></span>
  <div class="grid grid-cols-[auto_1fr] gap-8 pl-8">
    <span class="font-mono text-2xl font-light text-[#132728]/20 transition-colors duration-300
                 ease-[cubic-bezier(.16,1,.3,1)] group-hover:text-[#046C88]">01</span>
    <div>
      <h3 class="font-display text-2xl font-semibold text-[#132728]">Clawback nativo</h3>
      <p class="mt-3 max-w-[70ch] text-lg font-light leading-relaxed text-[#132728]/70">
        Cada token PLINA-RF carrega <span class="font-mono text-sm tracking-[0.05em]">AUTH_CLAWBACK_ENABLED</span>
        no emissor Stellar.
      </p>
    </div>
  </div>
</div>
```

---

## 9. Layout and motion

### Spacing scale

`1px` hairline · `8px` · `16px` · `32px` (card padding) · `64px` · `128px` (section rhythm) ·
`160px` (lead capture, closing). Horizontal gutter `clamp(24px, 8vw, 120px)`.
Content container `1280px`.

### Section rhythm

```html
<main>
  <section class="bg-[#080f10] py-32">   <!-- Hero: blobs live here -->
  <section class="bg-white py-32">        <!-- Produto -->
  <section class="bg-[#e4e4e4] py-32">    <!-- Tese: numbered list -->
  <section class="bg-[#132728] py-32">    <!-- Infraestrutura -->
  <section class="bg-white py-40">        <!-- Lead capture -->
</main>
```

Density is **high in content, low in decoration**. Generous whitespace is not empty space — it is
what makes dense regulatory information readable.

### Motion

**One easing for everything: `cubic-bezier(0.16, 1, 0.3, 1)`** (ease-out-quart).

| Duration | Use |
|---|---|
| 150ms | Colour/opacity on small controls |
| 300ms | Button and link states |
| 500ms | Surface fill on hover |
| 700ms | The signature cyan bar scale-y |
| 900ms | Scroll reveal and hero entrance |

Reveals are **opacity + a small `translateY(20px)`** only. No scale-in, no rotation, no stagger
beyond ~80ms steps. Every animation **MUST** be disabled under `prefers-reduced-motion: reduce`.

### Accessibility floor

- Body text meets WCAG AA (4.5:1); use §3's table, do not estimate.
- Focus is always visible: 2px ring at `outline-offset: 4px`, colour picked per surface (§3). Never
  `outline: none` without a replacement.
- Colour is never the only carrier of meaning — pair with a label, an icon or mono text.
- Target size ≥ 44×44px.
- A skip link is required on every page.
- The 300-weight body must not be used below 1rem; at small sizes step up to weight 400.

---

## 10. Voice and copy

Three pillars, taken directly from the brand guidelines:

- **Autoridade Técnica.** Full institutional vocabulary: FIDC, CVM 175, senior/subordinated classes,
  NAV, duration, yield. No simplification for the investor — institutional demands depth.
- **Precisão Regulatória.** Cite the framing explicitly: CVM 175, Lei 11.795/2008, BACEN, AML/KYC,
  LGPD. Clawback, `AUTH_REQUIRED` and SEPs are differentiators, not jargon.
- **Auditabilidade.** Everything verifiable: registered service providers, big-four audit, on-chain
  hash via Stellar Expert. Transparency replaces marketing.

**CTA register is consultative:** "Solicitar Prospecto", "Submeter Aplicação", "Agendar Roadshow",
"Solicitar Documentação Confidencial".

**Forbidden copy:** "Renda Fixa Digital" · "ganho rápido" · "rentabilidade garantida" · any Brazilian
retail-fintech framing (Nubank / Inter / C6 / Mercado Bitcoin register) · emoji · exclamation marks ·
aggressive imperatives · dumbing down technical terms. Avoid em-dashes in new copy; use a comma,
colon or full stop. (Copy already produced in the PDF brand guidelines keeps its original style.)

---

## 11. Reconciliations — conflicts already resolved

These arose between `docs/brand_guidelines.html` and `DESIGN.md`. Do not re-litigate them.

| Conflict | Resolution |
|---|---|
| Guidelines show `rounded-3xl` / `2rem` cards; DESIGN.md mandates 0 or 9999px | The 24px radius is **presentation-only** (`radius.deck`). Product UI stays binary: 0 or full. |
| Guidelines celebrate glow orbs and blobs; DESIGN.md forbids gradients and decoration | The blob motif is **legal décor on dark surfaces only** (§7). The no-gradient rule still holds absolutely for text, borders, and light-surface backgrounds. |
| Guidelines use `#080f10`; DESIGN.md forbids a fourth surface | Abyss is a **décor backdrop**, not a content surface. It carries the blob motif and nothing else. The sandwich remains three tones. |
| DESIGN.md sends cyan-deep `#057A99` to all light surfaces | **Corrected.** `#057A99` fails AA on Document Grey (3.89:1). `signal.700 #046C88` was added and passes on both light surfaces. |
| Guidelines render the TopBar as white on Action Cyan | **Corrected.** White on cyan is 2.85:1. Text on a cyan fill is always Deep Petrol (5.47:1). |
| DESIGN.md and `globals.css` set the focus ring to Action Cyan on every surface | **Corrected.** 2.85:1 / 2.24:1 on the light surfaces fails WCAG 2.2 SC 1.4.11 (3:1 non-text). The ring is now surface-aware: `signal.700` on light, `signal.500` on dark. |
| Guidelines list only Geist Mono for metadata | Geist (sans) carries uppercase labels, Geist Mono carries data. Both ship. |

---

## 12. Hard NO list

Gradient in text, section background or border (the blob motif in §7 is the sole exception, and it is
décor on dark only) · decorative drop shadows · coloured side-stripe borders wider than 1px at rest ·
the hero-metric template (big number + label + supporting stats + gradient accent) · repeated
icon + title + text card grids — use the numbered list instead · glassmorphism on content cards ·
a fourth content surface · nested cards · Inter/Söhne fintech defaults · white text on cyan ·
cyan as body text on light · emoji · Satoshi for meaningful numbers · any easing other than
`cubic-bezier(0.16, 1, 0.3, 1)`.

---

## 13. Self-check before returning generated UI

1. Count the cyan. More than three visible points, or more than ~10% of the viewport? Cut it.
2. Every cyan foreground — did you pick the step from §3's table for that exact surface?
3. Any text on a cyan fill — is it Deep Petrol? Any focus ring on a light surface — is it `#046C88`?
4. Any shadow? Only the single lead-capture CTA on hover is allowed.
5. Every radius — is it exactly `0` or `9999px`?
6. Every meaningful number — is it Geist Mono?
7. Every section — does it open with an eyebrow before the display heading?
8. Every transition — is it `cubic-bezier(0.16,1,0.3,1)`, and does it stop under reduced motion?
9. Body copy — Satoshi 300, capped at 70ch?
10. Did you reach for a card grid where the numbered list item was the right pattern?
11. Is the blob motif anywhere near a light surface or a content card? Remove it.
12. Does any copy use retail-fintech language, an exclamation mark, or an emoji?
