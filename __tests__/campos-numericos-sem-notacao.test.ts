import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { semNotacaoCientifica } from '@/lib/format/campo-numerico';

// I2 (achado BAIXO): <input type="number"> aceita "1e3", "1e-7", "+" e "-". Nos campos de valor isso chega ao servidor
// como texto que ele recusa (ou, no clawback, que o SDK aceitava como número). Bloqueamos as teclas já na tela.
describe('semNotacaoCientifica', () => {
  const tecla = (key: string) => ({ key, preventDefault: vi.fn() });
  it('bloqueia e, E, + e -', () => {
    for (const k of ['e', 'E', '+', '-']) {
      const ev = tecla(k);
      semNotacaoCientifica(ev);
      expect(ev.preventDefault, k).toHaveBeenCalledTimes(1);
    }
  });
  it('deixa passar dígitos, ponto, vírgula e as teclas de edição e navegação', () => {
    for (const k of ['0', '5', '9', '.', ',', 'Backspace', 'Delete', 'Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Home', 'End']) {
      const ev = tecla(k);
      semNotacaoCientifica(ev);
      expect(ev.preventDefault, k).not.toHaveBeenCalled();
    }
  });
});

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (nome === 'node_modules' || nome === '__tests__' || nome.startsWith('zz-')) continue;
    if (statSync(p).isDirectory()) arquivos(p, acc);
    else if (/\.tsx$/.test(nome)) acc.push(p);
  }
  return acc;
}

describe('todo <input type="number"> do app bloqueia a notação científica', () => {
  const achados: Array<{ arquivo: string; tag: string }> = [];
  for (const arquivo of [...arquivos('app'), ...arquivos('components')]) {
    const src = readFileSync(arquivo, 'utf8');
    let i = src.indexOf('type="number"');
    while (i !== -1) {
      const ini = src.lastIndexOf('<input', i);
      achados.push({ arquivo, tag: src.slice(ini, src.indexOf('/>', i)) });
      i = src.indexOf('type="number"', i + 1);
    }
  }

  it('há campos numéricos (a varredura não está vazia)', () => {
    expect(achados.length).toBeGreaterThanOrEqual(13);
  });
  it.each(achados.map((a, n) => [`${a.arquivo} #${n + 1}`, a.tag]))('%s', (_nome, tag) => {
    expect(tag).toContain('onKeyDown={semNotacaoCientifica}');
  });
});
