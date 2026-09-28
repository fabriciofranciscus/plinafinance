# Plina Finance — Design System for Lovable

**"The Regulated Terminal"** — translated from `DESIGN.md` into Lovable's stack
(Vite + React + TypeScript + Tailwind **v3** + shadcn/ui, HSL CSS variables).

How to use this file (4 steps):

1. **Knowledge** → paste *Part 1* into Lovable: *Project Settings → Knowledge*. This keeps every generation on-brand.
2. **Tokens** → replace `src/index.css` with *Part 2*.
3. **Tailwind** → replace/merge `tailwind.config.ts` with *Part 3*.
4. **Kickoff** → send *Part 5* as your first chat prompt.

---

## Part 1 — Knowledge (paste into Lovable › Knowledge)

> You are building **Plina Finance**: an institutional tokenizer of Brazilian consortium
> credit rights (a FIDC under CVM 175, token PLINA-RF, settled on Stellar). The audience is
> a Miami/Singapore/London **family-office risk desk**, not crypto retail. The visual register
> is **"The Regulated Terminal"** — an institutional financial terminal, *not* a Bloomberg
> neon-on-black trader screen and *not* crypto-degen RWA. Every screen must read, in 30
> seconds, as a formal regulated vehicle.
>
> **Non-negotiable doctrine:**
>
> - **Three-surface sandwich only.** Alternate sections between exactly three surfaces:
>   `sheet-white (#fff)`, `document-grey (#e4e4e4)`, `deep-petrol (#132728)`. Never a 4th tone.
>   Depth comes from surface contrast, **never** from shadows.
> - **Flat by doctrine.** No drop shadows on cards/surfaces at rest (one exception: the single
>   primary lead-capture CTA). No glassmorphism except the post-hero sticky navbar.
> - **No gradients.** Not in text, backgrounds, or borders. (Only tolerated exception: a near-
>   invisible radial décor on the dark institutional section.)
> - **The One Voice Rule.** `auditable-cyan (#0EA7C7)` is the system's single signal colour and
>   appears on **≤10% of any viewport** — active underlines, the logo period (`Plina.`), numbered
>   markers (`01 //`), eyebrow labels, hover bars, CTA hover. Never fills large surfaces.
> - **Surface-Aware Cyan.** Vibrant `#0EA7C7` is for text **only on deep-petrol** (passes AA).
>   On light surfaces use `auditable-cyan-deep (#057A99)` for any cyan text/eyebrow/link.
> - **Borders are 0px or 9999px** — nothing in between. Cards = sharp corners (`rounded-none`).
>   Buttons, chips, inputs = full pill (`rounded-full`).
> - **Hairlines, not borders.** Separate internal info with 1px `rgba(19,39,40,0.12)` on light
>   (or `rgba(255,255,255,0.10)` on dark), or `gap-px` over a hairline background. Never coloured borders.
>
> **Typography:**
>
> - **Chillax** (display/headline/title, weight 500–600, tight tracking) — the institutional voice.
> - **Satoshi 300** (body, light) — the Light-Body Rule; never use heavy weights for long copy.
> - **Geist** (labels: uppercase, 700, `tracking-[0.2em]+`) — eyebrows, metadata, CTA labels.
> - **Geist Mono** (data) — **The Mono-For-Data Rule:** any number that carries regulatory,
>   financial or technical meaning is mono (percentages, durations, `SEP-24`,
>   `AUTH_CLAWBACK_ENABLED`, AUM thresholds, `contato@plina.finance`). This is the system signature.
> - **Eyebrow-Headline Pair:** every section opens with a cyan uppercase eyebrow label
>   *immediately* followed by a Chillax display. Never a display alone.
>
> **Signature pattern — Numbered List Item** (reuse before inventing layouts): a light mono
> numeral (`01`, `A`) at `text-deep-petrol/20`, turning cyan on group-hover; a 1px×100% cyan bar
> pinned left that animates `scale-y-0 → scale-y-100`, `origin-top`, 700ms on group-hover;
> a `border-b` hairline divider; `py-16` vertical padding. **No** translate-y, **no** shadow.
>
> **Motion:** one easing everywhere — `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-quart). Reveals
> are opacity + small translate-y only. Respect `prefers-reduced-motion`.
>
> **Voice / copy:** consultative, never retail. Use "Solicitar Prospecto", "Submeter Aplicação",
> "Agendar Roadshow". **Never** "Renda Fixa Digital", "ganho rápido", "rentabilidade garantida",
> emoji, exclamation marks, or aggressive imperatives. Do not dumb down terms (CVM 175, FIDC,
> AUTH_CLAWBACK_ENABLED, SEP-38 appear as working tools). Avoid em-dashes in new copy.
>
> **Hard NO list:** gradient text/bg/border · decorative drop shadows · coloured side-stripe
> borders >1px at rest · the hero-metric template (big number + label + stats + gradient accent) ·
> repeated icon+title+text card grids (use numbered list instead) · glassmorphism on content cards ·
> a 4th surface colour · Inter/Söhne fintech defaults.

---

## Part 2 — `src/index.css` (drop-in replacement)

```css
/* Fonts — Chillax + Satoshi via Fontshare, Geist + Geist Mono via Google */
@import url('https://api.fontshare.com/v2/css?f[]=chillax@400,500,600,700&f[]=satoshi@300,400,500,700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@300;400;500&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* ---- Plina "Regulated Terminal" tokens (HSL, shadcn-compatible) ---- */
    --background: 0 0% 89%;        /* document-grey #e4e4e4 — the default page surface */
    --foreground: 183 36% 12%;     /* deep-petrol  #132728 — the dominant voice */

    --card: 0 0% 100%;             /* sheet-white  #ffffff */
    --card-foreground: 183 36% 12%;
    --popover: 0 0% 100%;
    --popover-foreground: 183 36% 12%;

    --primary: 183 36% 12%;        /* deep-petrol — primary CTA fill */
    --primary-foreground: 0 0% 100%;
    --secondary: 0 0% 89%;         /* document-grey */
    --secondary-foreground: 183 36% 12%;

    --muted: 0 0% 89%;
    --muted-foreground: 183 18% 35%;
    --accent: 190 87% 42%;         /* auditable-cyan #0EA7C7 — the single signal */
    --accent-foreground: 0 0% 100%;

    --destructive: 0 72% 45%;
    --destructive-foreground: 0 0% 100%;

    --border: 183 36% 12%;         /* used at /12 opacity → hairline; see utilities */
    --input: 0 0% 89%;
    --ring: 190 87% 42%;           /* cyan focus ring */

    --radius: 9999px;              /* pill by default; cards override to rounded-none */

    /* brand-named tokens (used via tailwind config) */
    --deep-petrol: 183 36% 12%;
    --sheet-white: 0 0% 100%;
    --document-grey: 0 0% 89%;
    --auditable-cyan: 190 87% 42%;
    --auditable-cyan-deep: 193 94% 31%;  /* #057A99 — cyan text on light surfaces */
    --stellar-mid: 204 62% 56%;          /* #4A9ED4 */
    --glacier-tint: 200 60% 77%;         /* #A0CFE7 */
    --hairline: 183 36% 12%;             /* applied at 12% alpha */
  }
}

@layer base {
  * { @apply border-border; }
  body {
    @apply bg-background text-foreground;
    font-family: 'Satoshi', system-ui, sans-serif;
    font-weight: 300;            /* Light-Body Rule */
    line-height: 1.6;
    overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3, h4, .font-display {
    font-family: 'Chillax', 'Satoshi', sans-serif;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.05;
  }
  ::selection { background: hsl(var(--auditable-cyan)); color: #fff; }
}

@layer components {
  /* hairline = the only structural separator */
  .hairline { border-color: hsl(var(--hairline) / 0.12); }
  .hairline-dark { border-color: hsl(0 0% 100% / 0.10); }

  /* eyebrow label — Geist uppercase, paired with every section headline */
  .eyebrow {
    font-family: 'Geist', sans-serif; font-weight: 700;
    font-size: 0.625rem; letter-spacing: 0.2em; text-transform: uppercase;
    color: hsl(var(--auditable-cyan-deep));   /* cyan-deep on light surfaces */
  }
  .eyebrow-on-dark { color: hsl(var(--auditable-cyan)); }  /* vibrant on deep-petrol */

  /* mono data — The Mono-For-Data Rule */
  .data { font-family: 'Geist Mono', monospace; font-weight: 500; letter-spacing: 0.05em; }
}

/* Motion — single easing, reduced-motion aware */
@layer utilities {
  .ease-terminal { transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); }
}
.reveal { opacity: 0; transform: translateY(20px);
  transition: opacity 600ms cubic-bezier(0.16,1,0.3,1), transform 600ms cubic-bezier(0.16,1,0.3,1); }
.reveal.active { opacity: 1; transform: none; }
@keyframes hero-fade-up { from { opacity: 0; transform: translateY(20px) } to { opacity: 1; transform: none } }
.animate-hero-text { opacity: 0; animation: hero-fade-up 900ms cubic-bezier(0.16,1,0.3,1) 150ms forwards; }
@media (prefers-reduced-motion: reduce) {
  .reveal, .animate-hero-text { animation: none !important; transition: none !important; opacity: 1 !important; transform: none !important; }
}
```

---

## Part 3 — `tailwind.config.ts` (replace / merge the `theme.extend` block)

```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary:   { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted:     { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent:    { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive:{ DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        card:      { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover:   { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },

        /* Plina brand tokens */
        "deep-petrol":        "hsl(var(--deep-petrol))",
        "sheet-white":        "hsl(var(--sheet-white))",
        "document-grey":      "hsl(var(--document-grey))",
        "auditable-cyan":     "hsl(var(--auditable-cyan))",
        "auditable-cyan-deep":"hsl(var(--auditable-cyan-deep))",
        "stellar-mid":        "hsl(var(--stellar-mid))",
        "glacier-tint":       "hsl(var(--glacier-tint))",
      },
      fontFamily: {
        display: ["Chillax", "Satoshi", "sans-serif"],
        sans:    ["Satoshi", "system-ui", "sans-serif"],
        label:   ["Geist", "sans-serif"],
        mono:    ["Geist Mono", "monospace"],
      },
      letterSpacing: { tightest: "-0.02em", label: "0.2em", wide: "0.3em" },
      borderRadius: { none: "0px", full: "9999px", lg: "var(--radius)" },
      spacing: { hairline: "1px", section: "8rem" /* py-32 */, lead: "10rem" /* py-40 */ },
      transitionTimingFunction: { terminal: "cubic-bezier(0.16, 1, 0.3, 1)" },
      keyframes: {
        "hero-fade-up": { from: { opacity: "0", transform: "translateY(20px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: { "hero-fade-up": "hero-fade-up 900ms cubic-bezier(0.16,1,0.3,1) forwards" },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
```

---

## Part 4 — Signature component patterns (give Lovable these as the canonical building blocks)

**Eyebrow + headline (every section opens this way):**
```tsx
<header className="space-y-4">
  <p className="eyebrow">01 // Tese Institucional</p>
  <h2 className="font-display text-4xl md:text-5xl text-deep-petrol">
    Direito creditório de consórcio, auditável on-chain.
  </h2>
</header>
```

**Numbered List Item — THE signature pattern (reuse before inventing card grids):**
```tsx
<div className="group relative border-b hairline py-16">
  <span className="absolute left-0 top-0 h-full w-px origin-top scale-y-0 bg-auditable-cyan
                   transition-transform duration-700 ease-terminal group-hover:scale-y-100" />
  <div className="grid grid-cols-[auto_1fr] gap-8 pl-8">
    <span className="data text-2xl text-deep-petrol/20 transition-colors duration-300 ease-terminal
                     group-hover:text-auditable-cyan">01</span>
    <div>
      <h3 className="font-display text-2xl text-deep-petrol">Clawback nativo</h3>
      <p className="mt-3 max-w-[65ch] font-sans text-lg font-light text-deep-petrol/80">
        Cada token PLINA-RF carrega <span className="data">AUTH_CLAWBACK_ENABLED</span> no emissor Stellar.
      </p>
    </div>
  </div>
</div>
```

**Primary / Ghost buttons (pill, Geist uppercase label):**
```tsx
{/* Primary — deep-petrol → cyan on hover */}
<button className="rounded-full bg-deep-petrol px-10 py-5 font-label text-[0.625rem] uppercase
                   tracking-label text-sheet-white transition-colors duration-300 ease-terminal
                   hover:bg-auditable-cyan">
  Solicitar Prospecto
</button>

{/* Ghost — on dark navbar */}
<button className="rounded-full bg-sheet-white px-5 py-2.5 font-label text-[0.6875rem] uppercase
                   tracking-label text-deep-petrol transition-colors hover:bg-document-grey">
  Agendar Roadshow
</button>
```

**Three-surface sandwich (section rhythm):**
```tsx
<main>
  <section className="bg-deep-petrol  text-sheet-white   py-section">{/* Hero */}</section>
  <section className="bg-sheet-white  text-deep-petrol   py-section">{/* Produto */}</section>
  <section className="bg-document-grey text-deep-petrol  py-section">{/* Tese */}</section>
  <section className="bg-deep-petrol  text-sheet-white   py-section">{/* Infra */}</section>
  <section className="bg-sheet-white  text-deep-petrol   py-lead">  {/* Lead capture */}</section>
</main>
```

**Hairline grid (instead of bordered cards):**
```tsx
<div className="grid grid-cols-1 gap-px bg-[hsl(var(--hairline)/0.12)] md:grid-cols-3">
  <article className="bg-sheet-white p-8 transition-colors duration-500 ease-terminal hover:bg-document-grey/40">…</article>
  {/* repeat — sharp corners, no shadow, separated only by gap-px hairline */}
</div>
```

---

## Part 5 — Kickoff prompt (send as your first message in Lovable)

> Build the **Plina Finance** institutional landing page following the design system in
> Knowledge ("The Regulated Terminal"). Stack: React + Tailwind + shadcn/ui.
>
> Sections, top to bottom, alternating the three-surface sandwich:
> 1. **Top bar** — `bg-auditable-cyan`, tiny Geist uppercase label: "Veículo institucional · CVM 175 · Stellar".
> 2. **Navbar** — transparent over hero, becomes `bg-deep-petrol/95 backdrop-blur` after scroll. Logo "Plina." (cyan period) + ghost CTA "Solicitar Prospecto".
> 3. **Hero** — `bg-deep-petrol`, Chillax display H1, Geist `tracking-[0.3em]` regulatory subtitle, animated fade-up.
> 4. **PLINA-RF (product)** — `bg-sheet-white`, eyebrow + headline + hairline grid of attributes.
> 5. **Tese** — `bg-document-grey`, use the **Numbered List Item** pattern (01/02/03), never a card grid.
> 6. **Infraestrutura auditável** — `bg-deep-petrol`, mono technical identifiers (`SEP-24`, `AUTH_CLAWBACK_ENABLED`).
> 7. **Equipe** — numbered list of founders.
> 8. **Lead capture** — `bg-sheet-white`, pill inputs, the single primary CTA with the only allowed shadow.
> 9. **Footer** — deep-petrol, Geist labels, `contato@plina.finance` in mono.
>
> Enforce: ≤10% cyan per viewport, cyan-deep for cyan text on light surfaces, no gradients, no
> shadows except the lead CTA, sharp-corner cards, hairline separators, Satoshi 300 body, Geist
> Mono for every meaningful number. Consultative copy only — no retail/fintech language, no emoji.
```
