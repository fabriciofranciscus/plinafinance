'use strict';
// Baixa as fontes da marca e as embute como data URI em fonts/embed.css.
// Necessário porque o Fontshare serve URL relativa de protocolo (//cdn...),
// que não resolve numa página file:// — e porque assim o build fica offline.
const fs = require('fs');
const path = require('path');
const https = require('https');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const SOURCES = [
  'https://api.fontshare.com/v2/css?f%5B%5D=chillax@600&display=swap',
  'https://api.fontshare.com/v2/css?f%5B%5D=satoshi@300,400,700&display=swap',
  'https://fonts.googleapis.com/css2?family=Geist:wght@400;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&display=swap',
];

const get = (url) =>
  new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error(url + ' -> ' + res.statusCode));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });

(async () => {
  const faces = [];
  for (const src of SOURCES) {
    const css = (await get(src)).toString('utf8');
    for (const block of css.match(/@font-face\s*\{[^}]+\}/g) || []) {
      if (/font-style:\s*italic/.test(block)) continue;
      const fam = (block.match(/font-family:\s*'?"?([^;'"]+)/) || [])[1].trim();
      const wt = ((block.match(/font-weight:\s*([^;]+)/) || [, '400'])[1]).trim();
      const ur = (block.match(/unicode-range:\s*([^;]+)/) || [])[1];
      const m = block.match(/url\((['"]?)(\/\/[^)'"]+\.woff2|https?:\/\/[^)'"]+\.woff2)\1\)/);
      if (!m) continue;
      const url = m[2].startsWith('//') ? 'https:' + m[2] : m[2];
      const data = await get(url);
      faces.push(
        "@font-face{font-family:'" + fam + "';font-style:normal;font-weight:" + wt +
        ";font-display:block;" + (ur ? 'unicode-range:' + ur.trim() + ';' : '') +
        "src:url(data:font/woff2;base64," + data.toString('base64') + ") format('woff2');}"
      );
      console.log('OK', fam, wt, Math.round(data.length / 1024) + 'KB');
    }
  }
  const dir = path.join(__dirname, 'fonts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'embed.css'), faces.join('\n'));
  console.log('embed.css:', Math.round(fs.statSync(path.join(dir, 'embed.css')).size / 1024) + 'KB');
})();
