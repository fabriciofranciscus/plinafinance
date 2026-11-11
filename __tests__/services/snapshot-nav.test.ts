import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

type Row = Record<string, any>;
const m = vi.hoisted(() => ({
  rows: [] as Array<Record<string, any>>,
  cotas: vi.fn(),
  grupos: vi.fn(),
  supply: vi.fn(),
  conc: vi.fn(),
  root: vi.fn(),
  ancora: vi.fn(),
  blob: vi.fn(),
  falhaCreateUnique: { v: false },
}));

vi.mock('@/lib/db', () => ({
  db: {
    cota: { findMany: m.cotas },
    movimentoFundo: { groupBy: m.grupos },
    snapshotNav: {
      findUnique: async ({ where }: { where: { data: string } }) => m.rows.find((r) => r.data === where.data) ?? null,
      findMany: async ({ where }: { where: { status: string; data: { lt: string } } }) =>
        m.rows.filter((r) => r.status === where.status && r.data < where.data.lt).sort((a, b) => (a.data < b.data ? -1 : 1)),
      create: async ({ data }: { data: Row }) => {
        if (m.falhaCreateUnique.v) {
          // Outra execução venceu a corrida: a linha dela já existe (PUBLICANDO, com lease).
          m.rows.push({ id: 'rival', status: 'PUBLICANDO', url: null, txHash: null, ...data, travaAte: new Date(Date.now() + 60_000) });
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = { id: `s${m.rows.length + 1}`, status: 'PUBLICANDO', url: null, txHash: null, publicadoEm: null, ...data };
        m.rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = m.rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const alvo = m.rows.filter(
          (r) =>
            r.id === where.id &&
            (!where.status || r.status === where.status) &&
            (!where.OR || where.OR.some((c: Row) => ('travaAte' in c && (c.travaAte === null ? r.travaAte == null : r.travaAte != null && r.travaAte < c.travaAte.lt)))),
        );
        alvo.forEach((r) => Object.assign(r, data));
        return { count: alvo.length };
      },
    },
  },
}));
vi.mock('@/lib/stellar/account', () => ({ horizon: { root: m.root } }));
vi.mock('@/lib/stellar/config', () => ({ STELLAR_NETWORK: 'TESTNET' }));
vi.mock('@/lib/services/nav-supply', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/nav-supply')>()),
  lerSupplyDoNav: m.supply,
}));
vi.mock('@/lib/stellar/conciliacao', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/conciliacao')>()),
  exigirConciliacao: m.conc,
}));
vi.mock('@/lib/stellar/ancora', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/ancora')>()),
  ancorarSha256: m.ancora,
}));
vi.mock('@/lib/integrations/blob/nav-snapshot', async (orig) => ({
  ...(await orig<typeof import('@/lib/integrations/blob/nav-snapshot')>()),
  publicarArquivoSnapshot: m.blob,
}));

import { AncoraError } from '@/lib/stellar/ancora';
import { ConciliacaoError } from '@/lib/stellar/conciliacao';
import { PublicacaoSnapshotError } from '@/lib/integrations/blob/nav-snapshot';
import { NavIndisponivelError } from '@/lib/services/nav-supply';
import { SnapshotNavError, publicarSnapshotNav } from '@/lib/services/snapshot-nav';
import { recalcularNav, type ArquivoSnapshotNav } from '@/lib/services/snapshot-nav-arquivo';

const D = (v: string) => new Prisma.Decimal(v);
const AGORA = new Date('2026-11-12T09:00:00.000Z');
const sha = (s: string) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

function sup(code: string, totalEmitido: string, tesouraria: string) {
  const total = D(totalEmitido);
  return {
    code,
    issuer: 'GISSUER',
    totalEmitido: total,
    tesouraria: D(tesouraria),
    circulante: total.minus(tesouraria),
    lidoEm: new Date('2026-11-12T08:59:59.000Z'),
  };
}
function conc(code: string, circulante: string, contas: number, confere = true) {
  return {
    code, issuer: 'GISSUER', somaTrustlinesAutorizadas: D(circulante), contasAutorizadas: contas,
    circulante: D(circulante), diferenca: D('0'), confere, motivos: [], lidoEm: new Date(),
  };
}

beforeEach(() => {
  process.env.STELLAR_DISTRIBUTOR_PUBLIC = 'GDISTRIBUTOR';
  m.rows.length = 0;
  m.falhaCreateUnique.v = false;
  m.cotas.mockReset().mockResolvedValue([
    { id: 'c1', status: 'DISPONIVEL', valorCarta: D('100000.00'), desagioAquisicao: D('0.2000'), tokensEmitidos: D('80000') },
  ]);
  m.grupos.mockReset().mockResolvedValue([
    { tipo: 'SUBSCRICAO', _sum: { deltaCaixa: D('2000') }, _count: { _all: 2 } },
  ]);
  m.root.mockReset().mockResolvedValue({ history_latest_ledger: 5000, history_latest_ledger_closed_at: '2026-11-12T08:59:55Z' });
  m.supply.mockReset().mockResolvedValue({ senior: sup('PLINARF', '82000', '0'), subordinada: sup('PLINARFB', '0', '0') });
  m.conc.mockReset().mockResolvedValue({ senior: conc('PLINARF', '82000', 3), subordinada: conc('PLINARFB', '0', 0) });
  m.blob.mockReset().mockImplementation(async ({ data }: { data: string }) => ({ url: `https://blob.example/nav-snapshots/${data}.json` }));
  m.ancora.mockReset().mockResolvedValue({ txHash: 'a'.repeat(64), reutilizada: false, ledgerCloseTime: '2026-11-12T09:00:05Z' });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('publicarSnapshotNav', () => {
  it('caminho feliz: arquivo canônico, SHA-256 dos mesmos bytes publicado E ancorado, linha PUBLICADO', async () => {
    const r = await publicarSnapshotNav({ agora: AGORA });
    expect(r).toMatchObject({ publicado: true, reutilizada: false, data: '2026-11-12', txHash: 'a'.repeat(64), pendentes: 0 });
    expect(r.url).toBe('https://blob.example/nav-snapshots/2026-11-12.json');

    const bytes: Buffer = m.blob.mock.calls[0][0].bytes;
    expect(sha(bytes.toString('utf8'))).toBe(r.sha256);
    expect(m.ancora).toHaveBeenCalledWith({ sha256Hex: r.sha256, contexto: 'SNAPSHOT_NAV' });
    expect(m.rows[0]).toMatchObject({ status: 'PUBLICADO', sha256: r.sha256, txHash: 'a'.repeat(64), travaAte: null, ledger: 5000 });
    expect(m.rows[0].conteudo).toBe(bytes.toString('utf8'));

    const arq = JSON.parse(bytes.toString('utf8')) as ArquivoSnapshotNav;
    expect(arq).toMatchObject({ tipo: 'plina.nav-snapshot', versao: 1, data: '2026-11-12', rede: 'TESTNET' });
    expect(arq.horizon).toMatchObject({ ledger: 5000, ledgerFinal: 5000 });
    expect(arq.numerador.total).toBe('82000.0000000'); // 100000 × 0,80 + caixa 2000
    expect(arq.circulante.PLINARF).toMatchObject({ distributor: 'GDISTRIBUTOR', totalEmitido: '82000.0000000', saldoIssuer: '0.0000000', saldoDistributor: '0.0000000', circulante: '82000.0000000' });
    expect(arq.nav).toMatchObject({ classe: 'PLINARF', regra: 'NAV_DO_LEDGER', porToken: '1.00000000' });
    // o que o revisor recalcula do arquivo é o NAV publicado
    expect(recalcularNav(arq).porToken.toFixed(8)).toBe(arq.nav.porToken);
    // sem PII e sem float
    expect(bytes.toString('utf8')).not.toMatch(/cpf|email|@|\d\.\d+[,}\]](?!")/i);
  });

  it('2ª chamada no mesmo dia: reutilizada, sem gates, sem Blob e sem 2ª âncora', async () => {
    const a = await publicarSnapshotNav({ agora: AGORA });
    m.supply.mockClear(); m.conc.mockClear(); m.blob.mockClear(); m.ancora.mockClear();
    const b = await publicarSnapshotNav({ agora: new Date('2026-11-12T23:59:00Z') });
    expect(b).toMatchObject({ reutilizada: true, sha256: a.sha256, txHash: a.txHash, url: a.url });
    expect(m.supply).not.toHaveBeenCalled();
    expect(m.conc).not.toHaveBeenCalled();
    expect(m.blob).not.toHaveBeenCalled();
    expect(m.ancora).not.toHaveBeenCalled();
    expect(m.rows).toHaveLength(1);
  });

  it('dia UTC seguinte gera outro snapshot', async () => {
    await publicarSnapshotNav({ agora: AGORA });
    const r = await publicarSnapshotNav({ agora: new Date('2026-11-13T00:00:01Z') });
    expect(r.reutilizada).toBe(false);
    expect(m.rows.map((x) => x.data)).toEqual(['2026-11-12', '2026-11-13']);
  });

  it.each(['SUBORDINADA_CIRCULANDO', 'EMISSAO_PENDENTE', 'SWAP_EM_VOO', 'LEDGER_LEITURA_FALHOU'] as const)(
    'NAV indisponível (%s): não publica, não grava, não ancora',
    async (motivo) => {
      m.supply.mockRejectedValue(new NavIndisponivelError(motivo));
      await expect(publicarSnapshotNav({ agora: AGORA })).rejects.toMatchObject({ code: 'NAV_INDISPONIVEL', causa: motivo });
      expect(m.rows).toHaveLength(0);
      expect(m.blob).not.toHaveBeenCalled();
      expect(m.ancora).not.toHaveBeenCalled();
    },
  );

  it('conciliação diverge: não publica, não grava, não ancora', async () => {
    m.conc.mockRejectedValue(new ConciliacaoError('CONCILIACAO_DIVERGENTE', [conc('PLINARF', '82000', 3, false)]));
    await expect(publicarSnapshotNav({ agora: AGORA })).rejects.toMatchObject({ code: 'CONCILIACAO_DIVERGENTE' });
    expect(m.rows).toHaveLength(0);
    expect(m.blob).not.toHaveBeenCalled();
    expect(m.ancora).not.toHaveBeenCalled();
  });

  it('NAV não positivo (caixa negativo acima do ativo): não publica', async () => {
    m.grupos.mockResolvedValue([{ tipo: 'RESGATE_PAGO', _sum: { deltaCaixa: D('-90000') }, _count: { _all: 1 } }]);
    await expect(publicarSnapshotNav({ agora: AGORA })).rejects.toMatchObject({ code: 'NAV_INDISPONIVEL', causa: 'NAV_NAO_POSITIVO' });
    expect(m.rows).toHaveLength(0);
  });

  it('numerador mudou durante a geração: não publica', async () => {
    m.grupos
      .mockResolvedValueOnce([{ tipo: 'SUBSCRICAO', _sum: { deltaCaixa: D('2000') }, _count: { _all: 2 } }])
      .mockResolvedValueOnce([{ tipo: 'SUBSCRICAO', _sum: { deltaCaixa: D('2500') }, _count: { _all: 3 } }]);
    await expect(publicarSnapshotNav({ agora: AGORA })).rejects.toMatchObject({ code: 'LEITURA_INCONSISTENTE', causa: 'NUMERADOR_MUDOU' });
    expect(m.rows).toHaveLength(0);
  });

  it('circulante do NAV ≠ circulante da conciliação: não publica', async () => {
    m.conc.mockResolvedValue({ senior: conc('PLINARF', '81999', 3), subordinada: conc('PLINARFB', '0', 0) });
    await expect(publicarSnapshotNav({ agora: AGORA })).rejects.toMatchObject({ code: 'LEITURA_INCONSISTENTE', causa: 'CIRCULANTE_MUDOU' });
    expect(m.rows).toHaveLength(0);
  });

  it('Blob falha: nada é ancorado; a repetição retoma com os MESMOS bytes (sem recalcular) e conclui', async () => {
    m.blob.mockRejectedValueOnce(new PublicacaoSnapshotError('FALHOU'));
    await expect(publicarSnapshotNav({ agora: AGORA })).rejects.toMatchObject({ code: 'PUBLICACAO_FALHOU' });
    expect(m.ancora).not.toHaveBeenCalled();
    expect(m.rows[0]).toMatchObject({ status: 'PUBLICANDO', travaAte: null });
    const hashGravado = m.rows[0].sha256;

    // O mundo mudou depois: a retomada não pode recalcular.
    m.supply.mockResolvedValue({ senior: sup('PLINARF', '90000', '0'), subordinada: sup('PLINARFB', '0', '0') });
    m.supply.mockClear();
    const r = await publicarSnapshotNav({ agora: new Date('2026-11-12T15:00:00Z') });
    expect(m.supply).not.toHaveBeenCalled();
    expect(r).toMatchObject({ reutilizada: false, sha256: hashGravado });
    expect(sha(m.blob.mock.calls[1][0].bytes.toString('utf8'))).toBe(hashGravado);
    expect(m.rows[0].status).toBe('PUBLICADO');
  });

  it('âncora falha: fica PUBLICANDO (sem txHash) e a repetição ancora o mesmo hash', async () => {
    m.ancora.mockRejectedValueOnce(new AncoraError('ANCORA_NAO_CONFIRMADA'));
    await expect(publicarSnapshotNav({ agora: AGORA })).rejects.toMatchObject({ code: 'ANCORA_FALHOU', causa: 'ANCORA_NAO_CONFIRMADA' });
    expect(m.rows[0]).toMatchObject({ status: 'PUBLICANDO', txHash: null, url: null });
    const r = await publicarSnapshotNav({ agora: AGORA });
    expect(r.txHash).toBe('a'.repeat(64));
    expect(m.ancora.mock.calls[1][0].sha256Hex).toBe(m.ancora.mock.calls[0][0].sha256Hex);
    expect(m.rows).toHaveLength(1);
  });

  it('outra execução segura o lease: EM_ANDAMENTO, sem publicar nem ancorar', async () => {
    await publicarSnapshotNav({ agora: AGORA }).catch(() => undefined);
    m.rows[0].status = 'PUBLICANDO';
    m.rows[0].txHash = null;
    m.rows[0].travaAte = new Date(AGORA.getTime() + 60_000);
    m.blob.mockClear(); m.ancora.mockClear();
    await expect(publicarSnapshotNav({ agora: AGORA })).rejects.toMatchObject({ code: 'EM_ANDAMENTO' });
    expect(m.blob).not.toHaveBeenCalled();
    expect(m.ancora).not.toHaveBeenCalled();
  });

  it('corrida no create (P2002): não duplica; devolve EM_ANDAMENTO quando a outra ainda publica', async () => {
    m.falhaCreateUnique.v = true;
    await expect(publicarSnapshotNav({ agora: AGORA })).rejects.toMatchObject({ code: 'EM_ANDAMENTO' });
    expect(m.blob).not.toHaveBeenCalled();
    expect(m.ancora).not.toHaveBeenCalled();
  });

  it('conteúdo gravado que não confere com o hash: recusa antes de publicar', async () => {
    m.rows.push({
      id: 'x', data: '2026-11-12', status: 'PUBLICANDO', conteudo: '{"adulterado":true}', sha256: 'f'.repeat(64),
      navPorToken: D('1'), ledger: 1, url: null, txHash: null, travaAte: null,
    });
    await expect(publicarSnapshotNav({ agora: AGORA })).rejects.toMatchObject({ code: 'CONTEUDO_ADULTERADO' });
    expect(m.blob).not.toHaveBeenCalled();
    expect(m.ancora).not.toHaveBeenCalled();
  });

  it('snapshot de dia anterior que ficou PUBLICANDO é retomado antes do de hoje', async () => {
    const conteudo = '{"tipo":"plina.nav-snapshot","antigo":true}';
    m.rows.push({ id: 'old', data: '2026-11-11', status: 'PUBLICANDO', conteudo, sha256: sha(conteudo), navPorToken: D('1'), ledger: 1, url: null, txHash: null, travaAte: null });
    const r = await publicarSnapshotNav({ agora: AGORA });
    expect(r).toMatchObject({ reutilizada: false, pendentes: 0 });
    expect(m.rows.find((x) => x.id === 'old')).toMatchObject({ status: 'PUBLICADO', txHash: 'a'.repeat(64) });
    expect(m.ancora.mock.calls[0][0].sha256Hex).toBe(sha(conteudo));
  });

  it('dia anterior que não consegue concluir conta como pendente (a rota levanta alerta)', async () => {
    const conteudo = '{"antigo":true}';
    m.rows.push({ id: 'old', data: '2026-11-11', status: 'PUBLICANDO', conteudo, sha256: sha(conteudo), navPorToken: D('1'), ledger: 1, url: null, txHash: null, travaAte: null });
    m.ancora.mockRejectedValueOnce(new AncoraError('ANCORA_FALHOU'));
    const r = await publicarSnapshotNav({ agora: AGORA });
    expect(r.pendentes).toBe(1);
    expect(m.rows.find((x) => x.id === 'old')?.status).toBe('PUBLICANDO');
  });

  it('erro de ledger que não é NavIndisponivel propaga (não vira publicação)', async () => {
    m.root.mockRejectedValue(new Error('horizon fora'));
    await expect(publicarSnapshotNav({ agora: AGORA })).rejects.toThrow('horizon fora');
    expect(m.rows).toHaveLength(0);
    expect(SnapshotNavError).toBeDefined();
  });
});
