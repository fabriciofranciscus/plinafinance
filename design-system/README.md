# Plina Finance Design System v1.1

A portable, machine-readable design system built to be **consumed by LLMs and AI builders** —
Claude, ChatGPT, Cursor, v0, Lovable, Bolt — so that any of them produces on-brand Plina UI without
being re-briefed each time.

Derived from `docs/brand_guidelines.html` (Identity & Visual Guidelines v1.0) and reconciled with the
`DESIGN.md` doctrine already in this repo.

---

## Files

| File | Format | Who consumes it |
|---|---|---|
| **`plina-design-system.md`** | Markdown, self-contained | **The canonical spec.** Paste whole into an LLM as project knowledge. Also the doc humans read. |
| **`PROMPT.md`** | Markdown, ~1 page | Compact version for tight context: system prompts, `.cursorrules`, Lovable Knowledge, v0 briefs. |
| **`tokens.json`** | W3C DTCG | Machine-readable source of truth. Style Dictionary, Figma Tokens, Terrazzo, custom codegen. |
| **`tokens.css`** | Plain CSS custom properties | Any project, any framework, no build step. Includes component and motif primitives. |
| **`tailwind-v4.css`** | Tailwind v4 `@theme` | This repo's stack (Next.js 16 + Tailwind v4). Merge into `app/globals.css`. |
| `../docs/Plina_Lovable_Design_System.md` | Tailwind v3 + shadcn HSL | Lovable / v0 / any shadcn project. Pre-existing; still valid. |

Precedence when two files disagree: `plina-design-system.md` → `tokens.json` →
`docs/brand_guidelines.html` → `DESIGN.md`.

---

## How to feed it to each tool

**Claude / ChatGPT / any chat model**
Attach `plina-design-system.md`, then prompt normally. It is written to be self-sufficient — the model
should not need to ask follow-up questions about colour, type, spacing or voice.

**Claude Code / Cursor / Windsurf**
Point the project rules at it:
```md
<!-- CLAUDE.md or .cursorrules -->
For any UI work, follow @design-system/plina-design-system.md. It is authoritative
over your defaults. Run its section 13 self-check before returning generated UI.
```

**Lovable**
Project Settings → Knowledge → paste `PROMPT.md`. Then follow
`docs/Plina_Lovable_Design_System.md` for the Tailwind v3 / shadcn token wiring.

**v0 / Bolt**
Paste `PROMPT.md` at the top of the first message, then describe the screen.

**Figma / Style Dictionary / Terrazzo**
Consume `tokens.json` directly — it is standard W3C DTCG with `$type` / `$value` and aliases.

**A plain HTML page, an email, a one-off prototype**
Link `tokens.css`. It carries the font imports, every token, the component primitives and the blob
motif with no build step.

---

## What is in the system, in one screen

**Three surfaces, never a fourth:** Sheet White `#ffffff` · Document Grey `#e4e4e4` ·
Deep Petrol `#132728`. Abyss `#080f10` is décor canvas only.

**One signal, ≤10% of any viewport:** Action Cyan `#0EA7C7` on dark, `#057A99` on Sheet White,
`#046C88` on any light surface, Deep Petrol for text **on** a cyan fill.

**Four faces:** Chillax 600 display · Satoshi 300 body · Geist 700 uppercase labels ·
Geist Mono for every number that carries meaning.

**Flat by doctrine:** no shadows at rest; depth is tonal sandwich + hairlines. Exactly one shadow
exists in the whole system.

**Binary radius:** 0 for cards, 9999px for controls. Nothing between.

**One easing:** `cubic-bezier(0.16, 1, 0.3, 1)`.

**One motif:** Ambient Light Blobs — diffuse cyan luminosity on dark canvases only.

---

## What changed from v1.0 → v1.1

The brand guidelines and `DESIGN.md` disagreed in seven places. All seven are resolved in
`plina-design-system.md` §11; three of them were genuine accessibility bugs, each caught by
`check-contrast.mjs`:

- **`#057A99` fails AA on Document Grey** (3.89:1) — but `DESIGN.md` routed all light-surface cyan text
  to it. Added `signal.700 #046C88`, which passes on both light surfaces (4.71:1 / 5.99:1).
- **White on Action Cyan is 2.85:1** — used in the announcement TopBar in the brand guidelines. Text on
  a cyan fill is now always Deep Petrol (5.47:1).
- **The Action Cyan focus ring fails WCAG 2.2 SC 1.4.11 on light surfaces** (2.85:1 / 2.24:1 against a
  3:1 non-text minimum). Focus rings are now surface-aware like every other cyan.

The other four: the deck's 24px card radius is now scoped presentation-only; the blob motif is now
explicitly legal as dark-surface décor without weakening the no-gradient rule; Abyss is classified as a
backdrop rather than a fourth surface; Geist and Geist Mono have distinct documented roles.

These three bugs are **live in `app/globals.css` and `DESIGN.md` today** — this package documents the
fix but does not apply it. See "Applying the fixes to this repo" below.

---

## Applying the fixes to this repo

This package is documentation and tokens; it does **not** modify the running app. What is live today:

**1. Focus rings — 20 occurrences across 16 files.**
`focus:ring-primary` / `focus-visible:outline-primary` resolve to Action Cyan. On the dark surfaces
(`components/SiteHeader.tsx`) that is correct. On the light-surface forms it is 2.85:1 / 2.24:1 and
fails SC 1.4.11 — `app/vender/page.tsx`, `app/admin/*`, `app/comprar/**`, `app/minha-posicao/page.tsx`
and `components/vender/StepperVender.tsx` all sit on white or `document-grey`. Those should move to
`primary-deep`-class tokens, or to a new `--color-focus-ring` that resolves per surface.

**2. White on cyan — one live occurrence.**
`components/LeadCaptureSection.tsx:302` pairs `text-white` with `hover:bg-primary` (2.85:1). Every
other primary button in the app already hovers to `bg-primary-deep` with white text (4.94:1) and is
fine. The bug is mostly in the *doctrine* — `DESIGN.md` §5 and the brand guidelines TopBar both
specify white on Action Cyan.

**3. `#057A99` on Document Grey.**
`--color-primary-deep` is used widely for eyebrows and links. It is safe on `bg-white` (4.94:1) but
3.89:1 on `bg-lightBg` / `document-grey`. Add `--color-primary-ink: #046C88` to `app/globals.css` and
route the `document-grey`-surface cases to it.

None of these are behavioural bugs, so none block a release. Fix them when you next touch those
surfaces, or all at once with a token rename.

---

## Keeping it honest

`tokens.json` is the source of truth. If you change a colour there, re-verify contrast before shipping:

```bash
node design-system/check-contrast.mjs
```

Every ratio quoted in `plina-design-system.md` §3 comes from that script.
