# Fontes ITF (não versionadas)

Chillax e Satoshi usam a ITF Free Font License 2.0: o site pode servir os arquivos,
mas o repositório é público e **não pode** conter os `.woff2`. O Git ignora esta pasta
(exceto este README). Sem os arquivos, o CSS usa Geist.

Arquivos esperados aqui (sem alterar nem converter):

- `Chillax-Semibold.woff2` (600)
- `Chillax-Medium.woff2` (500)
- `Satoshi-Light.woff2` (300)
- `Satoshi-Regular.woff2` (400)

Origem e licenças: `~/OpenBot/Shared/plina/exports/design/landing-v2/assets/fonts/LICENSES.md`.
`app/layout.tsx` só declara as faces que existirem em disco (ou com `PLINA_ITF_FONTS=1`).
