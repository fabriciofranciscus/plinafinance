'use strict';
// Conversor markdown -> HTML para o subconjunto usado nos docs da Plina.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (t) => t.replace(/[&<>"]/g, (c) => ESC[c]);

// Glifos de status -> rotulo tipografico (o design system proibe emoji).
const GLYPH = [
  ['✅', 'ok', 'OK'],
  ['🔧', 'fix', 'AJUSTE'],
  ['🆕', 'new', 'NOVO'],
  ['⛔', 'out', 'SAI'],
  ['🟡', 'part', 'PARCIAL'],
  ['🔲', 'todo', 'NÃO INICIADO'],
  ['🔴', 'crit', 'CRÍTICO'],
  ['🛡', 'val', 'VALOR'],
  ['⚠️', 'warn', 'ATENÇÃO'],
  ['⚠', 'warn', 'ATENÇÃO'],
  ['🔑', 'key', 'CHAVE'],
];

function glyphs(html) {
  for (const [g, cls, label] of GLYPH) {
    html = html.split(g).join('<span class="tag tag-' + cls + '">' + label + '</span>');
  }
  return html.split('⤷').join('&rarr;');
}

// Geist Mono e obrigatorio para numero com significado (design system 4).
const DATA_RE = [
  /(R\$\s?[\d.,]+(?:\s?[kKmMbB])?)/g,
  /(US\$\s?[\d.,]+(?:\s?[kKmMbB])?)/g,
  /(\d+(?:[.,]\d+)?%)/g,
  /\b(SEP-\d+)\b/g,
  /\b(PLINA-RF|PLINARFS|PLINARFB|PLINARF|TESOURO|USDC|EURC)\b/g,
  /\b(CVM\s?\d+|SEV[123])\b/g,
  /\b(AUTH_[A-Z_]+)\b/g,
];

function dataFont(html) {
  return html
    .split(/(<[^>]+>)/)
    .map((part, i) => {
      if (i % 2) return part;
      let out = part;
      for (const re of DATA_RE) out = out.replace(re, '<span class="mono">$1</span>');
      return out;
    })
    .join('');
}

const PH_OPEN = '\u0001';
const PH_CLOSE = '\u0002';

function inline(text) {
  const spans = [];
  let t = text.replace(/`([^`]+)`/g, (_, c) => {
    spans.push('<code>' + esc(c) + '</code>');
    return PH_OPEN + (spans.length - 1) + PH_CLOSE;
  });
  t = esc(t);
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) =>
    /^https?:/.test(href)
      ? '<a href="' + href + '">' + label + '</a>'
      : '<span class="xref">' + label + '</span>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  t = t.replace(new RegExp(PH_OPEN + '(\\d+)' + PH_CLOSE, 'g'), (_, i) => spans[Number(i)]);
  return dataFont(glyphs(t));
}

const isTableSep = (l) => !!l && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes('-');
const cells = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

function renderList(items) {
  // items: { depth, ordered, text } — aninha o <ul> dentro do <li> pai.
  let html = '';
  const stack = [];
  let depth = -1;
  for (const it of items) {
    if (it.depth > depth) {
      html += it.ordered ? '<ol>' : '<ul>';
      stack.push({ ordered: it.ordered });
      depth = it.depth;
    } else {
      html += '</li>';
      while (it.depth < depth) {
        const s = stack.pop();
        html += s.ordered ? '</ol>' : '</ul>';
        html += '</li>';
        depth--;
      }
    }
    html += '<li>' + inline(it.text);
  }
  if (stack.length) html += '</li>';
  while (stack.length) {
    const s = stack.pop();
    html += s.ordered ? '</ol>' : '</ul>';
    if (stack.length) html += '</li>';
  }
  return html;
}

function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }

    if (/^>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push('<blockquote>' + blocks(buf) + '</blockquote>');
      continue;
    }

    if (line.includes('|') && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      const th = head.map((c) => '<th>' + inline(c) + '</th>').join('');
      const tb = rows
        .map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>')
        .join('');
      out.push('<table><thead><tr>' + th + '</tr></thead><tbody>' + tb + '</tbody></table>');
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>');
      i++;
      continue;
    }

    if (/^\s*-{3,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s*$/.test(line)) { i++; continue; }

    if (/^(\s*)([-*]|\d+\.)\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m) {
          items.push({
            depth: Math.floor(m[1].length / 2),
            ordered: /\d/.test(m[2]),
            text: m[3],
          });
          i++;
          continue;
        }
        if (items.length && /^\s+\S/.test(lines[i])) {
          items[items.length - 1].text += ' ' + lines[i].trim();
          i++;
          continue;
        }
        break;
      }
      out.push(renderList(items));
      continue;
    }

    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|>|\s*```|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]) &&
      !/^\s*-{3,}\s*$/.test(lines[i]) &&
      !(lines[i].includes('|') && isTableSep(lines[i + 1]))
    ) {
      buf.push(lines[i++]);
    }
    if (buf.length) out.push('<p>' + inline(buf.join(' ')) + '</p>');
    else i++;
  }
  return out.join('\n');
}

module.exports = { mdToHtml: (md) => blocks(md.replace(/\r/g, '').split('\n')) };
