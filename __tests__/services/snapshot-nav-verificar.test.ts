import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { canonicalizar } from '@/lib/services/json-canonico';
import { montarNumerador, recalcularNav, type ArquivoSnapshotNav } from '@/lib/services/snapshot-nav-arquivo';
import { verificarSnapshot, type LeitorHorizon, type TxHorizon } from '@/lib/services/snapshot-nav-verificar';

const D = (v: string) => new Prisma.Decimal(v);
const DIST = 'GDIST';

function arquivoBase(): ArquivoSnapshotNav {
  const numerador = montarNumerador(
    [{ id: 'c1', status: 'DISPONIVEL', valorCarta: '100000.00', desagioAquisicao: '0.2000' }],
    { movimentos: 1, porTipo: { SUBSCRICAO: '2000' } },
  );
  const base = {
    numerador,
    circulante: {
      PLINARF: {
        issuer: 'GISS', distributor: DIST, totalEmitido: '82000.0000000', saldoIssuer: '0.0000000',
        saldoDistributor: '0.0000000', circulante: '82000.0000000',
        trustlinesAutorizadas: { contas: 3, soma: '82000.0000000' },
      },
    },
    nav: { classe: 'PLINARF', regra: 'NAV_DO_LEDGER' as const, denominador: '', porToken: '', porTokenSobreCirculante: null, notaDenominador: '' },
  };
  const r = recalcularNav(base);
  return {
    tipo: 'plina.nav-snapshot', versao: 1, data: '2026-11-12', geradoEm: '2026-11-12T09:00:00.000Z', rede: 'TESTNET',
    horizon: { ledger: 100, fechadoEm: '2026-11-12T08:59:55Z', lidoEm: '2026-11-12T08:59:59.000Z', ledgerFinal: 101 },
    ...base,
    conciliacao: { PLINARF: { confere: true, diferenca: '0.0000000' } },
    nav: {
      classe: 'PLINARF', regra: r.regra, denominador: r.denominador.toFixed(7), porToken: r.porToken.toFixed(8),
      porTokenSobreCirculante: r.porTokenSobreCirculante!.toFixed(8), notaDenominador: 'n',
    },
  };
}
const bytesDe = (a: unknown) => Buffer.from(canonicalizar(a), 'utf8');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function leitor(over: Partial<{ ledger: number; emitido: string; dist: string; soma: string; contas: number; txs: (memo: string) => TxHorizon[] }> = {}): LeitorHorizon {
  const o = { ledger: 101, emitido: '82000', dist: '0', soma: '82000', contas: 3, ...over };
  return {
    ledgerAtual: async () => ({ ledger: o.ledger, fechadoEm: '2026-11-12T09:01:00Z' }),
    totalEmitido: async () => D(o.emitido),
    saldoDaConta: async () => D(o.dist),
    trustlinesAutorizadas: async () => ({ soma: D(o.soma), contas: o.contas }),
    buscarPorMemo: async (_c, memo) =>
      (o.txs ?? ((m) => [{ hash: 'tx1', successful: true, source_account: DIST, memo_type: 'hash', memo: m, created_at: '2026-11-12T09:00:06Z' }]))(memo),
  };
}
const PLINA = { issuerEsperado: 'GISS', distributorEsperado: DIST, redeEsperada: 'testnet' };
const estado = (r: Awaited<ReturnType<typeof verificarSnapshot>>, id: string) => r.conferencias.find((c) => c.id === id)?.estado;

describe('verificarSnapshot (a prova do avaliador)', () => {
  it('arquivo honesto, âncora com memo = SHA-256, Horizon igual: tudo ✓, saída 0', async () => {
    const bytes = bytesDe(arquivoBase());
    const r = await verificarSnapshot(bytes, leitor(), PLINA);
    expect(r.codigoSaida).toBe(0);
    expect(r.sha256).toBe(sha(bytes));
    expect(r.conferencias.every((c) => c.estado === 'ok')).toBe(true);
  });

  it('F-E31-2: sem fixar issuer/distributor da Plina o resultado NUNCA é "conferido" (saída 2) e imprime as contas do arquivo', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor());
    expect(r.codigoSaida).toBe(2);
    expect(estado(r, 'contas-da-plina-fixadas')).toBe('nao_conferido');
    expect(r.conferencias.find((c) => c.id === 'contas-da-plina-fixadas')?.detalhe).toMatch(/GISS.*GDIST/);
  });

  it('F-E31-2: arquivo forjado com contas de outra parte é reprovado quando as da Plina são fixadas', async () => {
    const a = arquivoBase();
    a.circulante.PLINARF.issuer = 'GATACANTE_ISSUER';
    a.circulante.PLINARF.distributor = 'GATACANTE_DIST';
    const r = await verificarSnapshot(bytesDe(a), leitor({ txs: (m) => [{ hash: 'tx1', successful: true, source_account: 'GATACANTE_DIST', memo_type: 'hash', memo: m, created_at: 'x' }] }), PLINA);
    expect(estado(r, 'contas-da-plina')).toBe('falhou');
    expect(r.codigoSaida).toBe(1);
  });

  it('memo da âncora ≠ SHA-256 do arquivo (arquivo trocado depois de ancorar): falha', async () => {
    const original = bytesDe(arquivoBase());
    const adulterado = bytesDe({ ...arquivoBase(), data: '2026-11-13' });
    const memoDoOriginal = Buffer.from(sha(original), 'hex').toString('base64');
    const r = await verificarSnapshot(adulterado, leitor({ txs: (m) => (m === memoDoOriginal ? [] : []) }));
    expect(estado(r, 'ancora')).toBe('falhou');
    expect(r.codigoSaida).toBe(1);
  });

  it('âncora de outra conta (fonte diferente do distributor) não vale', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor({
      txs: (m) => [{ hash: 'tx9', successful: true, source_account: 'GOUTRO', memo_type: 'hash', memo: m, created_at: 'x' }],
    }));
    expect(estado(r, 'ancora')).toBe('falhou');
  });

  it('tx falhada com o memo certo não vale', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor({
      txs: (m) => [{ hash: 'tx9', successful: false, source_account: DIST, memo_type: 'hash', memo: m, created_at: 'x' }],
    }));
    expect(estado(r, 'ancora')).toBe('falhou');
  });

  it('--tx diferente da âncora achada: falha', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor(), { txHash: 'outra' });
    expect(estado(r, 'ancora')).toBe('falhou');
  });

  it('arquivo não canônico (espaço a mais, mesmas chaves): recusa — o hash seria de outros bytes', async () => {
    const r = await verificarSnapshot(Buffer.from(JSON.stringify(arquivoBase(), null, 1), 'utf8'), leitor());
    expect(estado(r, 'arquivo')).toBe('falhou');
    expect(r.codigoSaida).toBe(1);
  });

  it('NAV do arquivo que não sai da própria conta (porToken editado): falha', async () => {
    const a = arquivoBase();
    a.nav.porToken = '9.99999999';
    const r = await verificarSnapshot(bytesDe(a), leitor());
    expect(estado(r, 'nav-do-arquivo')).toBe('falhou');
  });

  it('Horizon diverge no MESMO ledger do arquivo: falha (não é desculpa de tempo)', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor({ ledger: 101, emitido: '90000', soma: '90000' }));
    expect(estado(r, 'horizon-PLINARF')).toBe('falhou');
    expect(r.codigoSaida).toBe(1);
  });

  it('saldos mudaram depois do ledger do arquivo: "não conferido" (saída 2), sem reprovar nem fingir ✓', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor({ ledger: 5000, emitido: '90000', soma: '90000' }));
    expect(estado(r, 'horizon-PLINARF')).toBe('nao_conferido');
    expect(estado(r, 'ancora')).toBe('ok');
    expect(estado(r, 'nav-do-arquivo')).toBe('ok');
    expect(r.codigoSaida).toBe(2);
  });

  it('conciliação do próprio arquivo quebrada (Σ trustlines ≠ circulante): falha', async () => {
    const a = arquivoBase();
    a.circulante.PLINARF.trustlinesAutorizadas.soma = '81000.0000000';
    const r = await verificarSnapshot(bytesDe(a), leitor({ soma: '81000' }));
    expect(estado(r, 'conciliacao-PLINARF')).toBe('falhou');
  });

  it('NAV_INICIAL com ativo > 0 no arquivo (R$ 1,00 dando o pool ao 1º investidor): falha', async () => {
    const a = arquivoBase();
    a.circulante.PLINARF = { ...a.circulante.PLINARF, totalEmitido: '0.0000000', circulante: '0.0000000', trustlinesAutorizadas: { contas: 0, soma: '0.0000000' } };
    a.nav = { ...a.nav, regra: 'NAV_INICIAL', denominador: '0.0000000', porToken: '1.00000000', porTokenSobreCirculante: null };
    const r = await verificarSnapshot(bytesDe(a), leitor({ emitido: '0', soma: '0', contas: 0 }));
    expect(estado(r, 'nav-do-arquivo')).toBe('falhou');
  });

  it('rede do arquivo ≠ rede informada: falha', async () => {
    const r = await verificarSnapshot(bytesDe({ ...arquivoBase(), rede: 'PUBLIC' }), leitor(), PLINA);
    expect(estado(r, 'rede')).toBe('falhou');
    expect(r.codigoSaida).toBe(1);
  });

  it('âncora de outra conta que não o distributor INFORMADO (o arquivo declara a conta do atacante e ela ancorou): falha', async () => {
    const a = arquivoBase();
    a.circulante.PLINARF.distributor = 'GATACANTE_DIST';
    const r = await verificarSnapshot(
      bytesDe(a),
      leitor({ txs: (m) => [{ hash: 'tx1', successful: true, source_account: 'GATACANTE_DIST', memo_type: 'hash', memo: m, created_at: 'x' }] }),
      PLINA,
    );
    expect(estado(r, 'ancora')).toBe('falhou'); // busca/exige source = distributor informado
    expect(estado(r, 'contas-da-plina')).toBe('falhou');
    expect(r.codigoSaida).toBe(1);
  });

  it('F-E31-3: a saída diz que denominador e conciliação vêm do Horizon e o numerador são insumos publicados com hash ancorado', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor(), PLINA);
    expect(r.conferencias.find((c) => c.id === 'numerador')?.detalhe).toMatch(
      /denominador e conciliação refeitos do Horizon; numerador = insumos publicados.*hash de validação ancorado/,
    );
  });

  it('não é JSON: falha sem lançar', async () => {
    const r = await verificarSnapshot(Buffer.from('não é json'), leitor());
    expect(r.codigoSaida).toBe(1);
    expect(estado(r, 'arquivo')).toBe('falhou');
  });
});
