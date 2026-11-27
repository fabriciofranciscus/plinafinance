// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { rotuloPagamentoPix } from '@/lib/admin/pix-rotulo';
import { revisaoDe } from '../vendedor-pipeline';

// Íris (#157, baixo) + Norma (✓ nos 5 rótulos de StatusTransferenciaPix): a Revisão de "Reabrir pagamento" mostra a situação do
// Pix anterior e a tela nunca imprime o valor cru do banco ("PROCESSANDO"). Sem "Pix" no rótulo (critério da Norma).
afterEach(cleanup);

describe('rotuloPagamentoPix: os 5 valores de StatusTransferenciaPix, como a Norma aprovou', () => {
  it.each([
    ['ENVIANDO', 'Pagamento sendo enviado'],
    ['PROCESSANDO', 'Pagamento em processamento'],
    ['INCERTO', 'Pagamento sem confirmação'],
    ['FALHOU', 'Pagamento não concluído'],
    ['COMPROVADA', 'Pagamento comprovado'],
  ])('%s → "%s"', (cru, humano) => {
    expect(rotuloPagamentoPix(cru)).toBe(humano);
  });
  it('INCERTO nunca diz que falhou', () => {
    expect(rotuloPagamentoPix('INCERTO')).not.toMatch(/falh|não conclu/i);
  });
  it('ausente ou desconhecido não vai cru: texto neutro', () => {
    for (const v of [null, undefined, '', 'CODIGO_NOVO']) {
      expect(rotuloPagamentoPix(v)).toBe('Pagamento sem informação');
    }
  });
  it('nenhum rótulo cita "Pix" nem contém sublinhado ou o nome do enum', () => {
    for (const v of ['ENVIANDO', 'PROCESSANDO', 'INCERTO', 'FALHOU', 'COMPROVADA', null]) {
      expect(rotuloPagamentoPix(v)).not.toMatch(/pix|_/i);
      expect(rotuloPagamentoPix(v)).not.toMatch(/^[A-Z]{4,}/); // enum em caixa alta
    }
  });
});

const lead = (pixStatus: string | null) =>
  ({
    id: 'l1', nome: 'Cedente', email: 'c@x.t', status: 'OFERTA_ACEITA', criadoEm: '2026-11-20T00:00:00Z',
    ofertas: [{ id: 'o1', versao: 1, tipoBem: 'IMOVEL', valorCarta: '150000', valorLiquidoVendedor: '120000', desagioAquisicao: '0.2', administradora: 'Porto', status: 'ACEITA', validade: null, criadaEm: '2026-11-20T00:00:00Z',
      cessao: { id: 'c1', status: 'ASSINADA', pixStatus } }],
  }) as never;

describe('Revisão de "Reabrir pagamento"', () => {
  it('traz a linha "Pagamento anterior" com a situação em texto humano, entre o resumo e a rede', () => {
    const r = revisaoDe('reabrir-pagamento-cedente', lead('FALHOU'), false);
    const rotulos = r.linhas.map((l) => l.rotulo);
    expect(rotulos).toContain('Pagamento anterior');
    expect(rotulos.indexOf('Pagamento anterior')).toBeLessThan(rotulos.indexOf('Rede'));
    const { container } = render(<dl>{r.linhas.find((l) => l.rotulo === 'Pagamento anterior')!.valor}</dl>);
    expect(container.textContent).toBe('Pagamento não concluído');
  });
  it('sem situação conhecida mostra o texto neutro, nunca o cru', () => {
    const r = revisaoDe('reabrir-pagamento-cedente', lead(null), false);
    const { container } = render(<dl>{r.linhas.find((l) => l.rotulo === 'Pagamento anterior')!.valor}</dl>);
    expect(container.textContent).toBe('Pagamento sem informação');
  });
  it('as outras ações NÃO ganham a linha', () => {
    for (const a of ['pagar-cedente', 'registrar-cessao', 'registrar-laudo', 'incorporar-cota'] as const) {
      expect(revisaoDe(a, lead('FALHOU'), false).linhas.map((l) => l.rotulo), a).not.toContain('Pagamento anterior');
    }
  });
});

describe('a frase do Pix em andamento não imprime o enum', () => {
  const src = readFileSync('app/admin/vendedor-pipeline.tsx', 'utf8');
  it('usa o rótulo e mantém "Reconsultar não paga de novo."', () => {
    expect(src).toContain("from '@/lib/admin/pix-rotulo'");
    expect(src).toMatch(/\{rotuloPagamentoPix\(cessao\?\.pixStatus\)\}\. Reconsultar não paga de novo\./);
    expect(src).not.toMatch(/Pix em andamento \(\{cessao\?\.pixStatus\}\)/);
  });
});

describe('o aviso de falha confirmada não diz "Pix" nem "PSP"', () => {
  const src = readFileSync('app/admin/vendedor-pipeline.tsx', 'utf8');
  it('usa o texto aprovado pela Norma', () => {
    expect(src).toContain('O pagamento não foi concluído e foi confirmado pelo parceiro de pagamento. Reabrir pagamento é uma ação auditada.');
    expect(src).not.toContain('O Pix falhou');
    expect(src).not.toMatch(/confirmado pelo PSP/);
  });
});
