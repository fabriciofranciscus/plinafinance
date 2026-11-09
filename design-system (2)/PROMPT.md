# Plina Finance — compact design system prompt

Paste this into a system prompt, `.cursorrules`, a Lovable Knowledge box, or a v0 project brief when
you cannot fit the full `plina-design-system.md`. It is lossy by design: it keeps every rule that
changes output and drops the rationale.

---

You are generating UI for **Plina Finance**: an institutional tokenizer of Brazilian consortium credit
rights — a FIDC under CVM 175, token **PLINA-RF**, settled on **Stellar**. The audience is a
family-office risk desk in Miami/Singapore/London, not crypto retail. Visual register: **"The
Regulated Terminal"** — an institutional financial terminal, not a Bloomberg neon-on-black trader
screen and not crypto-degen RWA. Every screen must read in 30 seconds as a formal regulated vehicle.

**COLOUR — three surfaces only, never a fourth:**
`sheet-white #ffffff` · `document-grey #e4e4e4` · `deep-petrol #132728`.
`abyss #080f10` exists only as a décor canvas for the blob motif, never as a content surface.

**COLOUR — one signal, ≤10% of any viewport.** More than three visible cyan points is wrong.
Pick the cyan step by surface, these ratios are measured:

- on deep-petrol / abyss → `#0EA7C7` (5.47 / 6.79)
- on sheet-white only → `#057A99` (4.94)
- on document-grey, or any light surface you are not certain about → `#046C88` (4.71 / 5.99)
- text sitting **on** a cyan fill → `#132728` (5.47). **White on cyan is 2.85 and is forbidden**,
  including the announcement TopBar.
- **focus rings follow the same rule** — `#046C88` on light, `#0EA7C7` on dark. Action Cyan on a light
  surface is 2.85 / 2.24 and fails the 3:1 non-text minimum (WCAG 2.2 SC 1.4.11).
- `#4A9ED4` and `#A0CFE7` are dark-surface only; both fail AA on every light surface.

Cyan is allowed on: active underlines, the logotype period, numbered markers, eyebrow labels, the
hover bar, TopBar fill, CTA hover, focus rings, the blob motif. Never as body text on light, never
as a large fill.

**INK:** body on light `#132728`; secondary on light `rgba(19,39,40,.7)`; body on dark `#e4e4e4`;
secondary on dark `#A0CFE7`. Decorative numerals `rgba(19,39,40,.2)` — rest state only.

**SEPARATION:** hairlines only. `1px rgba(19,39,40,.12)` on light, `1px rgba(255,255,255,.10)` on
dark, or `gap-px` over a hairline background. Never a coloured border.

**TYPE:** Chillax 600 (display/headline/title/logotype, tracking −0.02em) · Satoshi **300** (body,
1.125rem, leading 1.6, max 70ch) · Geist 700 uppercase tracking 0.2em (eyebrows, labels, buttons) ·
**Geist Mono for every number that carries meaning** — percentages, durations, NAV, AUM, `SEP-24`,
`AUTH_CLAWBACK_ENABLED`, hashes, `PLINA-RF`, `contato@plina.finance`. This is the system signature.
Every section opens with a cyan uppercase eyebrow immediately followed by a Chillax display; never a
display alone.

**LOGOTYPE:** `Plina` in Chillax 600 + a period in cyan. The period is the mark; never drop it,
recolour it, or box the wordmark.

**SHAPE:** radius is `0` or `9999px`, nothing between. Cards/tiles/panels sharp; buttons/chips/inputs
pill. Cards are never nested.

**ELEVATION:** flat. No shadows at rest anywhere. The only shadow in the system is
`0 20px 25px -5px rgba(14,167,199,.2)` on hover of the single primary lead-capture CTA. No
glassmorphism except the sticky navbar after the hero.

**MOTIF — Ambient Light Blobs:** 3–4 absolutely-positioned blurred ellipses (`border-radius:50%`,
`blur(40–55px)`, cyan at 0.22 / 0.13 / 0.10 / 0.07 alpha) on an abyss or deep-petrol canvas, clustered
asymmetrically with one bleeding off-canvas. Décor only: dark surfaces, behind content, never on a
light surface, never behind or inside a content card, never interactive. Otherwise **no gradients** —
not in text, not in borders, not in light backgrounds.

**MOTION:** one easing everywhere, `cubic-bezier(0.16, 1, 0.3, 1)`. 300ms buttons · 500ms surface
fills · 700ms the signature bar · 900ms reveals. Reveals are opacity + `translateY(20px)` only. All
motion disabled under `prefers-reduced-motion`.

**SIGNATURE PATTERN — numbered list item.** Reuse before inventing a card grid: mono numeral at
`text-[#132728]/20` turning cyan on group-hover; a 1px×100% cyan bar pinned left animating
`scale-y-0 → scale-y-100` from `origin-top` over 700ms; `border-b` hairline; `py-16`. No translate,
no scale, no shadow.

**LAYOUT:** section rhythm `py-32` (`py-40` for lead capture and closing), gutter
`clamp(24px, 8vw, 120px)`, container 1280px, card padding 32px. High density in content, low in
decoration.

**ACCESSIBILITY:** AA (4.5:1) for body text using the ratios above, visible 2px focus ring at
`outline-offset: 4px` in the surface-appropriate cyan step, colour never the sole carrier of meaning,
targets ≥44px, skip link on every page.

**VOICE:** technical authority (full institutional vocabulary, no simplification), regulatory
precision (cite CVM 175, Lei 11.795/2008, BACEN, AML/KYC, LGPD explicitly), auditability
(everything verifiable on-chain). CTAs are consultative: "Solicitar Prospecto", "Submeter Aplicação",
"Agendar Roadshow".

**HARD NO:** gradient text/border/light backgrounds · decorative shadows · coloured side-stripes >1px
at rest · the hero-metric template (big number + label + stats + gradient accent) · repeated
icon+title+text card grids · glassmorphism on content cards · a fourth surface · nested cards ·
Inter/Söhne defaults · white on cyan · cyan body text on light · Action Cyan focus rings on light ·
emoji · exclamation marks ·
Satoshi for meaningful numbers · "Renda Fixa Digital", "ganho rápido", "rentabilidade garantida",
or any Brazilian retail-fintech register · any easing other than `cubic-bezier(0.16,1,0.3,1)`.

**BEFORE RETURNING:** count the cyan (≤3 points, ≤10%) · verify each cyan step against its actual
surface · confirm text on any cyan fill is `#132728` · confirm zero shadows except the lead CTA ·
confirm every radius is 0 or 9999px · confirm every meaningful number is mono · confirm every section
has its eyebrow · confirm reduced-motion is handled.
