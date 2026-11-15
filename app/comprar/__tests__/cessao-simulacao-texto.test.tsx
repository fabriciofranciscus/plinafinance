import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CessaoScreen } from '../_components/screens/cessao';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const pessoa = { nome: 'Comprador Teste', email: 'c@exemplo.test' } as never;

describe('/comprar: a cessão do comprador é uma simulação (A-27, Consuelo)', () => {
  const html = renderToStaticMarkup(<CessaoScreen pessoa={pessoa} cota={null} reserva={null} cessao={null} signing={false} onAssinar={() => {}} />);

  it('o título e o aviso dizem que é demonstração e que nenhum contrato real é assinado', () => {
    expect(html).toContain('Modelo de contrato de cessão (demonstração).');
    expect(html).toContain('Simulação na rede de testes: nenhum contrato real é assinado.');
    expect(html).toContain('Plina');
  });

  it('o botão é "Simular assinatura →"; nada de e-CPF nem de "hash do documento registrado on-chain"', () => {
    expect(html).toContain('Simular assinatura →');
    expect(html).not.toMatch(/e-CPF|hash do documento registrado|Assinar com/);
  });

  it('em execução o botão diz "Simulando…"', () => {
    const h = renderToStaticMarkup(<CessaoScreen pessoa={pessoa} cota={null} reserva={null} cessao={null} signing onAssinar={() => {}} />);
    expect(h).toContain('Simulando…');
    expect(h).not.toContain('Assinando…');
  });

  it('o comprovante do comprador não chama o envelope stub de "e-CPF/DocuSign"', () => {
    const src = readFileSync('app/comprar/[reservaId]/comprovante/page.tsx', 'utf8');
    expect(src).toContain('label="Registro da simulação (rede de testes)"');
    expect(src).not.toMatch(/e-CPF\/DocuSign/);
  });
});
