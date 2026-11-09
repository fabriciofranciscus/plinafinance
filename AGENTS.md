<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design system

For any UI work, read `design-system/plina-design-system.md` first. It is authoritative over your
visual defaults — colour, typography, spacing, motion, components, and copy voice. Run its section 13
self-check before returning generated UI.

- `design-system/tokens.json` is the machine-readable source of truth for token values.
- `design-system/PROMPT.md` is the compact version, for when the full spec will not fit.
- `node design-system/check-contrast.mjs` verifies every colour pairing the system depends on. Run it
  after changing any colour token.
- `DESIGN.md` predates the system and has three known accessibility errors, listed in
  `plina-design-system.md` §11. Where they disagree, the design system wins.
