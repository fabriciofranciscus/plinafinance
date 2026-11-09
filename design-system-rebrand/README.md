# Plina Rebrand Design System v2.0 — **candidate**

A parallel, self-contained design system derived from
`Plina landing page nova/Plina Landing v3 - Rebrand.dc.html`.

> ## This is not official yet
>
> `design-system/` remains the authoritative system for every Plina surface — the landing page, the
> app, the decks, anything an agent generates by default. **Nothing in this folder changes any
> existing product.** `AGENTS.md` still points at the official spec, deliberately.
>
> Use this system only where the rebrand has been explicitly asked for.

---

## Files

| File | Format | Who consumes it |
|---|---|---|
| **`plina-rebrand-design-system.md`** | Markdown, self-contained | **The canonical spec.** Paste whole into an LLM; also the doc humans read |
| **`PROMPT.md`** | Markdown, ~1 page | Compact version for tight context: system prompts, `.cursorrules`, Lovable, v0 |
| **`tokens.json`** | W3C DTCG | Machine-readable source of truth. Style Dictionary, Figma Tokens, Terrazzo |
| **`tokens.css`** | CSS custom properties | Any project, no build step. Includes component primitives |
| **`check-contrast.mjs`** | Node script | Verifies every pairing the system claims is legal |

Precedence inside the rebrand: `plina-rebrand-design-system.md` → `tokens.json` → `tokens.css`.
Precedence against the repo: **the official `design-system/` always wins**, until officialisation.

---

## Verify before you ship

```bash
node design-system-rebrand/check-contrast.mjs
```

Unlike the official checker, this one **composites alpha inks over their background** before
measuring — the rebrand's whole ink scale is alpha-based, so a checker that only understood opaque
hex would verify nothing that matters. It also asserts the *negative* rules: cyan must keep failing
on light surfaces, faint ink must keep failing as body text.

Run it after touching any colour token. It exits non-zero on failure.

---

## What is different from the official system, in one screen

**Dark-first.** `#0C1719` is the page, not an accent. Light appears twice, at the close, where the
reader is asked to act. Five surfaces in two families instead of three.

**Two ink floors.** The deeper canvas buys three notches of transparency: alpha ink bottoms out at
`0.55` on dark but at `0.65` on light. Never carry one scale onto the other — this is the single
easiest way to break the system.

**Mono is the protagonist.** Geist Mono carries eyebrows, every number, every numeral. Two number
sizes with different meanings: cyan `numeric-xl` is evidence about the operation, ink `numeric-l` is
a claim about the product.

**Photography replaces the blob motif.** Person / asset / market, documentary, never stock. The
thesis is that the collateral is real, so the art direction shows it.

**Stricter on depth, and the brand has no edges.** Zero shadows: the official system's one CTA
exception is removed. On radius the rebrand goes the other way and follows `brand_guidelines.html`
("sem arestas, sem rigidez") instead of `DESIGN.md` ("Corner Style: 0px"), which inverted its own
source. Four steps: `12px` photographs, `24px` filled panels, `9999px` controls, `0` structure.
Panels round more than photographs so a coloured panel never reads as another image.

**Breakpoints are obligations.** Three of them, each with a required behaviour. This fixes a real
defect in the v3 artboard, where the `52px 190px 1fr` step row leaves ~45px for its description on a
375px screen.

Section 11 of the spec is the full divergence table. Section 11 also carries the officialisation
checklist — including deleting this folder, because two live design systems is the failure mode this
separation exists to avoid.
