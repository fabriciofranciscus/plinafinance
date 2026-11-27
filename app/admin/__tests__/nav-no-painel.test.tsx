/**
 * /admin, NAV e supply (#156 + M17). Duas leituras na página: o NAV/token usa a leitura COM os gates (`lerSupplyDoNav`) e mostra o
 * motivo quando fecha; o cartão de supply usa a leitura BRUTA do ledger (`lerSupplyParaPainel`), para o operador ver a divergência
 * justamente quando o NAV fecha, com a nota do M17 quando essa leitura falha. Renderiza a página de servidor nesses estados.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ ler: vi.fn(), bruto: vi.fn(), caixa: vi.fn() }));

vi.mock('@/lib/auth/admin', () => ({ isAdminAuthenticated: async () => true }));
vi.mock('@/lib/db', () => {
  const vazio = { findMany: async () => [] };
  return {
    db: {
      parametrosPool: { findUnique: async () => ({ id: 'singleton', assetCode: 'PLINARF', network: 'TESTNET', issuerPublic: 'GA', distributorPublic: 'GB' }) },
      cota: vazio, investidor: vazio, leadVendedor: vazio, leadComprador: vazio, eventoAudit: vazio, realizacaoCaminho: vazio, transferenciaPix: vazio,
    },
  };
});
vi.mock('@/lib/stellar/supply', async (orig) => ({ ...(await orig<typeof import('@/lib/stellar/supply')>()), fetchSupplyOnChainFromEnv: m.bruto }));
vi.mock('@/lib/services/razao-fundo', () => ({ caixaParaNav: m.caixa }));
vi.mock('@/lib/services/nav-supply', async (orig) => ({ ...(await orig<typeof import('@/lib/services/nav-supply')>()), lerSupplyDoNav: m.ler }));
vi.mock('../login-form', () => ({ LoginForm: () => null }));
vi.mock('../incorporar-cota-form', () => ({ IncorporarCotaForm: () => null }));
vi.mock('../investidores-painel', () => ({ InvestidoresPainel: () => null }));
vi.mock('../paineis', () => ({ PaineisAdmin: ({ secoes, paineis }: Record<string, unknown>) => {
  // o contêiner de abas não importa aqui: renderiza o conteúdo de todos os painéis
  const lista = (paineis ?? secoes ?? []) as Array<{ id: string; conteudo: React.ReactNode }>;
  return <>{lista.map((p) => <div key={p.id}>{p.conteudo}</div>)}</>;
} }));
vi.mock('../concentracao', () => ({ Concentracao: () => null }));
vi.mock('../validacao-form', () => ({ ValidacaoForm: () => null }));
vi.mock('../vendedor-pipeline', () => ({ VendedorPipeline: () => null }));
vi.mock('../comprador-pipeline', () => ({ CompradorPipeline: () => null }));

import AdminPage from '../page';
import { NAV_MOTIVO_OPERADOR, NavIndisponivelError, type NavIndisponivelMotivo } from '@/lib/services/nav-supply';

const NOTA = /Não foi possível ler o supply na rede agora/;
const D = (v: string) => new Prisma.Decimal(v);
const html = async () => renderToStaticMarkup(await AdminPage());

const SUPPLY = { code: 'PLINARF', circulante: D('1234'), tesouraria: D('0') };

beforeEach(() => {
  m.ler.mockReset();
  m.bruto.mockReset().mockResolvedValue(SUPPLY);
  m.caixa.mockReset().mockResolvedValue([{ valorRealizado: D('0'), spread: 0 }]); // forma de caixaParaNav: lista de "realizações"
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('/admin — NAV e supply', () => {
  it('leitura ok: NAV/token calculado e supply do ledger, sem painel de motivo e sem a nota', async () => {
    m.ler.mockResolvedValue({ senior: SUPPLY });
    m.caixa.mockResolvedValue([{ valorRealizado: D('1851'), spread: 0 }]); // sem cotas: NAV/token = 1851 / 1234 = 1,5
    const h = await html();
    expect(h).toContain('1.234');
    expect(h).toMatch(/R\$\s1,5000/);
    expect(h).not.toContain('Indisponível');
    expect(h).not.toContain('NAV por token indisponível');
    expect(h).not.toMatch(NOTA);
  });

  it.each(['SUPPLY_SEM_LASTRO', 'EMISSAO_PENDENTE', 'SWAP_EM_VOO', 'SUBORDINADA_CIRCULANDO', 'LEDGER_LEITURA_FALHOU'] as NavIndisponivelMotivo[])(
    'NAV fechado (%s) com o ledger legível: motivo, NAV "Indisponível", o supply CONTINUA à vista e sem a nota',
    async (motivo) => {
      m.ler.mockRejectedValue(new NavIndisponivelError(motivo));
      const h = await html();
      expect(h).toContain(`NAV por token indisponível · ${motivo}`);
      expect(h).toContain(NAV_MOTIVO_OPERADOR[motivo].slice(0, 30));
      expect(h).toContain('Indisponível');
      expect(h).toContain('1.234');
      expect(h).not.toMatch(NOTA);
    },
  );

  it('o ledger não responde: o painel abre, mostra o motivo e a nota (nos dois cartões), registra e não vaza a mensagem', async () => {
    m.ler.mockRejectedValue(new NavIndisponivelError('LEDGER_LEITURA_FALHOU'));
    m.bruto.mockRejectedValue(new Error('segredo https://x.test'));
    const h = await html();
    expect(h).toContain('NAV por token indisponível · LEDGER_LEITURA_FALHOU');
    expect(h.match(new RegExp(NOTA, 'g'))).toHaveLength(2);
    expect(h).not.toContain('1.234');
    expect(h).not.toContain('segredo');
    const log = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(log.length).toBeGreaterThan(0);
    expect(JSON.stringify(log)).not.toContain('segredo');
  });

  it('erro qualquer na leitura do NAV vira o motivo de leitura, sem vazar a mensagem', async () => {
    m.ler.mockRejectedValue(new Error('segredo https://x.test'));
    const h = await html();
    expect(h).toContain('NAV por token indisponível · LEDGER_LEITURA_FALHOU');
    expect(h).not.toContain('segredo');
  });
});
