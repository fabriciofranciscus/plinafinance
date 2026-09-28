# Dossiê PDF

Gera `docs/Plina-Dossie-<data>.pdf` — capa, sumário e os quatro documentos de negócio
(acompanhamento, decisões do CEO, PRD, arquitetura-alvo) num arquivo só, sob o design system.

```bash
node scripts/dossie/fetch-fonts.js   # uma vez; precisa de rede. Grava fonts/embed.css (ignorado no git)
node scripts/dossie/build.js         # gera o PDF
```

- `md.js` — conversor markdown→HTML do subconjunto usado nos docs. Mapeia os glifos de status
  (✅ 🔧 🆕 ⛔ 🟡 🔲 🔴 🛡 ⚠️) para rótulos tipográficos, porque o design system §12 proíbe emoji,
  e aplica Geist Mono a números com significado (§4, a regra Mono-For-Data).
- `fetch-fonts.js` — embute Chillax, Satoshi, Geist e Geist Mono como data URI. O Fontshare serve
  URL relativa de protocolo, que não resolve numa página `file://`; embutir também torna o build
  reproduzível sem rede.
- `build.js` — monta o HTML e imprime via Playwright/Chromium. Data, lista de documentos e
  metadados da capa ficam no topo do arquivo.
