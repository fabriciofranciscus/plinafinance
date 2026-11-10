import fs from 'node:fs';
import path from 'node:path';

/**
 * Chillax e Satoshi (ITF Free Font License 2.0): self-host permitido, mas os
 * arquivos NÃO podem estar no Git (repo público). Ficam em public/fonts/itf/,
 * pasta ignorada. Só declaramos as faces que existem em disco (ou com
 * PLINA_ITF_FONTS=1, para quem entrega os arquivos de outro jeito); sem elas
 * a pilha de CSS cai para Geist e não há pedido 404.
 * Pesos: só os 4 que a landing usa (landing-v2/assets/fonts/fonts.css).
 */
const FACES = [
  { family: 'Chillax', weight: 600, file: 'Chillax-Semibold.woff2' },
  { family: 'Chillax', weight: 500, file: 'Chillax-Medium.woff2' },
  { family: 'Satoshi', weight: 300, file: 'Satoshi-Light.woff2' },
  { family: 'Satoshi', weight: 400, file: 'Satoshi-Regular.woff2' },
] as const;

function fontCss(): string {
  const dir = path.join(process.cwd(), 'public', 'fonts', 'itf');
  const force = process.env.PLINA_ITF_FONTS === '1';
  return FACES.filter((f) => force || fs.existsSync(path.join(dir, f.file)))
    .map(
      (f) =>
        `@font-face{font-family:'${f.family}';src:url('/fonts/itf/${f.file}') format('woff2');font-weight:${f.weight};font-style:normal;font-display:swap}`,
    )
    .join('');
}

export function ItfFontFaces() {
  const css = fontCss();
  if (!css) return null;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
