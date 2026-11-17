import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// U2 A-13 (Vera): controles com alvo < 44 px a 390. Piso de 44 px só no celular (max-md), sem mudar o desenho a 1440.
// Contrato por elemento: o JSX do controle precisa trazer a classe. A medição real (390) fica na evidência da PR.
const MIN = 'max-md:min-h-[44px]';

/** Trecho do JSX do elemento que contém `marcador`: da abertura da tag até o fim da tag de abertura. */
function tag(arquivo: string, marcador: string): string {
  const src = readFileSync(arquivo, 'utf8');
  const i = src.indexOf(marcador);
  expect(i, `${arquivo}: marcador "${marcador}" não encontrado`).toBeGreaterThan(-1);
  const ini = Math.max(src.lastIndexOf('<a\n', i), src.lastIndexOf('<a ', i), src.lastIndexOf('<Link', i), src.lastIndexOf('<button', i), src.lastIndexOf('<select', i), src.lastIndexOf('<input', i));
  const fim = src.slice(ini).search(/(?<!=)>\s*\n/);
  return src.slice(ini, ini + (fim > -1 ? fim : 600));
}

describe('A-13: alvos de 44 px no celular', () => {
  it('logo do cabeçalho e do wizard', () => {
    expect(tag('components/AppHeader.tsx', 'font-title text-lg font-semibold')).toContain(MIN);
    expect(tag('components/vender/WizardHeader.tsx', 'aria-label="Plina · Início"')).toContain(MIN);
  });

  it('rodapé: todos os links do <footer> ganham 44 px no celular', () => {
    const f = readFileSync('components/AppFooter.tsx', 'utf8');
    // A classe vive numa constante usada por TODAS as variantes (completo, compacto, operação); o render é conferido em
    // app/__tests__/footer-variantes.test.tsx.
    expect(f).toMatch(/const MOBILE_ALVOS =\s*'[^']*max-md:\[&_a\]:min-h-\[44px\]/);
    expect((f.match(/<footer [^>]*\$\{MOBILE_ALVOS\}/g) ?? []).length).toBe(3);
  });

  it('link "Pular para conteúdo" tem 44 px quando aparece', () => {
    expect(readFileSync('app/globals.css', 'utf8')).toMatch(/\.skip-link\s*\{[^}]*min-height:\s*44px/);
  });

  it('botão "Sair" em /investir e /comprar', () => {
    expect(tag('app/investir/page.tsx', 'onClick={() => logout()}')).toContain(MIN);
    expect(tag('app/comprar/page.tsx', 'onClick={() => logout()}')).toContain(MIN);
  });

  it('campos e seletores do /investir (identidade), /comprar (filtros) e /vender', () => {
    const idt = readFileSync('app/investir/_components/screens/identity.tsx', 'utf8');
    expect(idt).toMatch(/const fieldCls =\s*'[^']*max-md:min-h-\[44px\]/);
    const bus = readFileSync('app/comprar/_components/screens/buscar.tsx', 'utf8');
    expect((bus.match(/max-md:min-h-\[44px\]/g) ?? []).length).toBeGreaterThanOrEqual(3); // 2 filtros + "Selecionar cota"
    const ven = readFileSync('app/vender/page.tsx', 'utf8');
    expect(ven).toMatch(/const inputClass =\s*'[^']*max-md:min-h-\[44px\]/);
  });

  it('/comprar: "Selecionar cota →"', () => {
    expect(tag('app/comprar/_components/screens/buscar.tsx', 'Selecionar cota')).toContain(MIN);
  });

  it('/minha-posicao: Atualizar, entrar, endereço, "Acessar oferta", "Ver pool completo" e o hash da transação', () => {
    const p = 'app/minha-posicao/page.tsx';
    expect(tag(p, "{loading ? 'Atualizando…' : 'Atualizar'}")).toContain(MIN);
    expect(tag(p, 'Entrar com e-mail')).toContain(MIN);
    expect(tag(p, 'href={explorerAccount(stellarAddress)}')).toContain(MIN);
    expect(tag(p, 'Acessar oferta')).toContain(MIN);
    expect(tag(p, 'Ver pool completo')).toContain(MIN);
    expect(tag(p, 'href={explorerTx(event.stellarTxHash)}')).toContain(MIN);
  });
});
