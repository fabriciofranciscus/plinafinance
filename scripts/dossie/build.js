'use strict';
const fs = require('fs');
const path = require('path');
const { mdToHtml } = require('./md.js');
const { chromium } = require('/home/dalekthai/Documentos/Workspace/Plina/node_modules/playwright');

const ROOT = '/home/dalekthai/Documentos/Workspace/Plina';
const FONTS = fs.readFileSync(path.join(__dirname, 'fonts', 'embed.css'), 'utf8');
const DATA = '19 de agosto de 2026';

// Bundles disponíveis: `node build.js [nome]` (default: dossie).
const BUNDLES = {
  dossie: {
    out: 'Plina-Dossie-2026-08-19.pdf',
    titulo: 'Dossiê de arquitetura e decisões',
    sub: 'Estado do produto, decisões pendentes do sponsor, plano por fase e arquitetura de destino — consolidados após a revisão de escopo contra o one-page do CEO.',
    docs: [
      { file: 'docs/ACOMPANHAMENTO-CEO.md', eyebrow: 'Documento 01', nome: 'Acompanhamento executivo' },
      { file: 'docs/DECISOES-CEO.md', eyebrow: 'Documento 02', nome: 'Decisões do CEO' },
      { file: 'docs/PRD-plina-v1.md', eyebrow: 'Documento 03', nome: 'PRD v1.1' },
      { file: 'docs/ARQUITETURA-ALVO.md', eyebrow: 'Documento 04', nome: 'Arquitetura-alvo' },
    ],
  },
  scf: {
    out: 'Plina-SCF-Integration-Track-2026-08-19.pdf',
    titulo: 'SCF Build · Integration Track',
    sub: 'Levantamento do Stellar Community Fund, da trilha de submissão e do parceiro que faz a indicação — com o mapeamento contra o estado real do produto e as decisões que ele força.',
    docs: [
      { file: 'docs/SCF-INTEGRATION-TRACK.md', eyebrow: 'Levantamento', nome: 'SCF Integration Track' },
    ],
  },
};

const BUNDLE = BUNDLES[process.argv[2] || 'dossie'];
if (!BUNDLE) {
  console.error('bundle desconhecido. Opções: ' + Object.keys(BUNDLES).join(', '));
  process.exit(1);
}
const OUT = path.join(ROOT, 'docs', BUNDLE.out);
const DOCS = BUNDLE.docs;

const CSS = `
:root{
  --sheet:#ffffff; --doc-grey:#e4e4e4; --petrol:#132728; --abyss:#080f10;
  --cyan-500:#0EA7C7; --cyan-700:#046C88;
  --ink:#132728; --ink-muted:rgba(19,39,40,.7);
  --ink-dark:#e4e4e4; --ink-dark-muted:#A0CFE7;
  --hair:rgba(19,39,40,.12); --hair-dark:rgba(255,255,255,.1);
}
@page{ size:A4; margin:18mm 16mm 16mm; }
*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; }
body{
  background:var(--sheet); color:var(--ink);
  font-family:'Satoshi','Segoe UI',system-ui,sans-serif; font-weight:300;
  font-size:9.3pt; line-height:1.6;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
h1,h2,h3,h4,h5,h6{
  font-family:'Chillax','Satoshi',system-ui,sans-serif; font-weight:600;
  color:var(--ink); margin:0 0 .5em; break-after:avoid; page-break-after:avoid;
}
h1{ font-size:24pt; line-height:1.05; letter-spacing:-.02em; margin-bottom:.3em; }
h2{ font-size:15pt; line-height:1.1; letter-spacing:-.015em; margin-top:1.9em;
    padding-top:.5em; border-top:1px solid var(--hair); }
h3{ font-size:11.5pt; line-height:1.2; letter-spacing:-.01em; margin-top:1.5em; }
h4{ font-size:9.6pt; margin-top:1.2em; }
p{ margin:0 0 .75em; max-width:74ch; }
strong{ font-weight:700; }
em{ font-style:italic; }
del{ color:var(--ink-muted); }
a{ color:var(--cyan-700); text-decoration:none; border-bottom:1px solid var(--hair); }
.xref{ color:var(--cyan-700); }
ul,ol{ margin:0 0 .8em; padding-left:1.15em; max-width:74ch; }
li{ margin:0 0 .3em; }
li>ul,li>ol{ margin-top:.3em; }
hr{ border:0; border-top:1px solid var(--hair); margin:1.4em 0; }

code,.mono,pre{ font-family:'Geist Mono','DejaVu Sans Mono',monospace; }
code{ font-size:8.4pt; font-weight:400; background:var(--doc-grey); padding:.05em .3em; }
.mono{ font-size:.94em; font-weight:500; letter-spacing:.02em; }
pre{ background:var(--doc-grey); padding:10px 12px; margin:0 0 1em; overflow:hidden;
     break-inside:avoid; page-break-inside:avoid; }
pre code{ background:none; padding:0; font-size:7.4pt; line-height:1.45; white-space:pre-wrap; }

table{ width:100%; border-collapse:collapse; margin:0 0 1.1em; font-size:8.1pt;
       break-inside:auto; }
th,td{ text-align:left; vertical-align:top; padding:5px 8px 5px 0;
       border-bottom:1px solid var(--hair); }
th{ font-family:'Geist',system-ui,sans-serif; font-weight:700; font-size:6.9pt;
    letter-spacing:.14em; text-transform:uppercase; color:var(--ink);
    border-bottom:1px solid var(--ink); padding-bottom:6px; }
tr{ break-inside:avoid; page-break-inside:avoid; }
thead{ display:table-header-group; }

blockquote{ margin:0 0 1em; padding:.1em 0 .1em 14px; border-left:1px solid var(--ink);
            color:var(--ink-muted); break-inside:avoid; }
blockquote p{ margin-bottom:.5em; }
blockquote strong{ color:var(--ink); }
blockquote table{ font-size:7.6pt; }

.tag{ font-family:'Geist',system-ui,sans-serif; font-weight:700; font-size:6.2pt;
      letter-spacing:.16em; text-transform:uppercase; background:var(--doc-grey);
      color:var(--ink); padding:1.5px 5px; white-space:nowrap; }
.tag-crit,.tag-out{ background:var(--petrol); color:var(--doc-grey); }
.tag-warn{ background:var(--petrol); color:var(--cyan-500); }

.eyebrow{ font-family:'Geist',system-ui,sans-serif; font-weight:700; font-size:6.9pt;
          letter-spacing:.2em; text-transform:uppercase; color:var(--cyan-700);
          margin:0 0 12px; }

/* Capa */
.cover{ background:var(--petrol); color:var(--ink-dark); padding:38mm 22mm;
        height:245mm; display:flex; flex-direction:column; justify-content:space-between;
        break-after:page; page-break-after:always; }
.cover .eyebrow{ color:var(--cyan-500); letter-spacing:.4em; margin-bottom:22px; }
.cover h1{ color:var(--ink-dark); font-size:38pt; margin:0 0 18px; max-width:22ch; }
.cover .sub{ color:var(--ink-dark-muted); font-size:11pt; max-width:52ch; }
.cover .meta{ border-top:1px solid var(--hair-dark); padding-top:14px; }
.cover .meta div{ display:flex; justify-content:space-between; padding:5px 0;
                  font-family:'Geist Mono',monospace; font-size:8pt; letter-spacing:.05em; }
.cover .meta .k{ color:var(--ink-dark-muted); }

/* Sumário */
.toc{ break-after:page; page-break-after:always; }
.toc h1{ font-size:20pt; margin-bottom:24px; }
.toc .item{ border-bottom:1px solid var(--hair); padding:9px 0; }
.toc .item .n{ font-family:'Geist Mono',monospace; font-size:7.5pt; letter-spacing:.12em;
               color:var(--cyan-700); }
.toc .item .t{ font-family:'Chillax','Satoshi',sans-serif; font-weight:600; font-size:11.5pt; }
.toc .item .d{ color:var(--ink-muted); font-size:8.2pt; max-width:70ch; }

.doc{ break-before:page; page-break-before:always; }
.doc > h1{ margin-bottom:18px; padding-bottom:14px; border-bottom:1px solid var(--ink); }
.doc > h2:first-of-type{ border-top:0; padding-top:0; }
`;

function build() {
  const parts = [];

  parts.push(`<section class="cover">
    <div>
      <p class="eyebrow">Plina Finance &middot; Confidencial</p>
      <h1>${BUNDLE.titulo}</h1>
      <p class="sub">${BUNDLE.sub}</p>
    </div>
    <div class="meta">
      <div><span class="k">Data</span><span>${DATA}</span></div>
      <div><span class="k">Preparado por</span><span>Thais &middot; CTO</span></div>
      <div><span class="k">Para</span><span>Fabrício &middot; CEO</span></div>
      <div><span class="k">Documentos</span><span>${String(DOCS.length).padStart(2, '0')}</span></div>
      <div><span class="k">Repo verificado em</span><span>chore/function-region-gru1 &middot; 6cb17a4</span></div>
    </div>
  </section>`);

  const toc = DOCS.map((d, i) => {
    const md = fs.readFileSync(path.join(ROOT, d.file), 'utf8');
    const h1 = (md.match(/^#\s+(.*)$/m) || [, d.nome])[1];
    return `<div class="item">
      <div class="n">${String(i + 1).padStart(2, '0')}</div>
      <div class="t">${h1.replace(/&/g, '&amp;')}</div>
      <div class="d">${d.file}</div>
    </div>`;
  }).join('');
  parts.push(`<section class="toc"><p class="eyebrow">Conteúdo</p><h1>Neste dossiê</h1>${toc}</section>`);

  for (const d of DOCS) {
    const md = fs.readFileSync(path.join(ROOT, d.file), 'utf8');
    parts.push(`<section class="doc"><p class="eyebrow">${d.eyebrow} &middot; ${d.nome}</p>${mdToHtml(md)}</section>`);
  }

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Plina — ${BUNDLE.titulo}</title>
<style>${FONTS}</style>
<style>${CSS}</style></head><body>${parts.join('\n')}</body></html>`;
}

(async () => {
  const html = build();
  const tmp = path.join(__dirname, 'dossie.html');
  fs.writeFileSync(tmp, html);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: OUT,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;padding:0 16mm;font-family:Geist,system-ui,sans-serif;
      font-size:6.5pt;letter-spacing:.18em;text-transform:uppercase;color:rgba(19,39,40,.55);
      display:flex;justify-content:space-between;">
      <span>Plina Finance &middot; Confidencial</span>
      <span class="pageNumber"></span></div>`,
    margin: { top: '18mm', bottom: '16mm', left: '16mm', right: '16mm' },
  });
  await browser.close();
  console.log('PDF:', OUT);
})();
