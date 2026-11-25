// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../actions', () => ({ incorporarCotaAction: vi.fn() }));

import { IncorporarCotaForm } from '../incorporar-cota-form';

// #157, opção (b) da Íris: a Revisão da incorporação avulsa mostra o aporte pela função única de lib/services/aporte.ts (BigInt,
// meio-par, igual ao servidor), com as strings CRUAS dos campos, e "—" quando o servidor recusaria. Nenhuma conta na tela.
afterEach(cleanup);

function abrir(carta: string, desagio: string) {
  render(<IncorporarCotaForm />);
  fireEvent.change(screen.getByLabelText('Administradora', { selector: 'input' }), { target: { value: 'Porto Seguro' } });
  fireEvent.change(screen.getByLabelText('Localização aproximada', { selector: 'input' }), { target: { value: 'São Paulo - SP' } });
  fireEvent.change(screen.getByLabelText('Valor da carta (BRL)', { selector: 'input' }), { target: { value: carta } });
  fireEvent.change(screen.getByLabelText('Deságio aquisição (0–1)', { selector: 'input' }), { target: { value: desagio } });
  fireEvent.click(screen.getByRole('button', { name: 'Incorporar cota + emitir PLINA-RF' }));
  return screen.getByTestId('revisao-acao').textContent!.replace(/ /g, ' ');
}
const aporte = (t: string) => t.match(/Valor do aporte \(NAV da cota\)\s*(R\$ [\d.,]+|—)/)?.[1];

describe('aporte na Revisão', () => {
  it('250.000 com 18% = R$ 205.000,00', () => {
    expect(aporte(abrir('250000', '0.18'))).toBe('R$ 205.000,00');
  });
  it('meio exato: 100,01 com 50% = R$ 50,00 (meio-par, como o servidor), não R$ 50,01 (ponto flutuante)', () => {
    expect(aporte(abrir('100.01', '0.5'))).toBe('R$ 50,00');
    cleanup();
    expect(aporte(abrir('100.05', '0.5'))).toBe('R$ 50,02');
    cleanup();
    expect(aporte(abrir('2.50', '0.99'))).toBe('R$ 0,02');
  });
  it('deságio 100% zera o aporte (o servidor recusaria com CUSTO_INVALIDO): "—", nunca R$ 0,00', () => {
    expect(aporte(abrir('250000', '1'))).toBe('—');
  });
  it('deságio acima de 1 nem abre a Revisão: o campo (max=1) barra antes, então não há número ao lado de uma recusa', () => {
    render(<IncorporarCotaForm />);
    fireEvent.change(screen.getByLabelText('Administradora', { selector: 'input' }), { target: { value: 'Porto Seguro' } });
    fireEvent.change(screen.getByLabelText('Localização aproximada', { selector: 'input' }), { target: { value: 'São Paulo - SP' } });
    fireEvent.change(screen.getByLabelText('Valor da carta (BRL)', { selector: 'input' }), { target: { value: '250000' } });
    fireEvent.change(screen.getByLabelText('Deságio aquisição (0–1)', { selector: 'input' }), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Incorporar cota + emitir PLINA-RF' }));
    expect(screen.queryByTestId('revisao-acao')).toBeNull();
  });
});

describe('a tela não calcula', () => {
  const src = readFileSync('app/admin/incorporar-cota-form.tsx', 'utf8');
  it('usa aporteDaCotaBrl com as strings cruas dos campos, sem Number() nem multiplicação', () => {
    expect(src).toContain("from '@/lib/services/aporte'");
    expect(src).toMatch(/aporteDaCotaBrl\(String\(d\.get\('valorCarta'\) \?\? ''\), String\(d\.get\('desagioAquisicao'\) \?\? ''\)\)/);
    expect(src).not.toMatch(/valorCarta \* \(1 - desagio\)|\* \(1 -/);
  });
  it('a função não importa nada (entra no bundle do cliente)', () => {
    expect(readFileSync('lib/services/aporte.ts', 'utf8')).not.toMatch(/^\s*import\s/m);
  });
});
