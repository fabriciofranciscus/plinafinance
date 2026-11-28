/**
 * Incorporação avulsa do /admin (ressalva do Argus no #157): a Revisão mostra "—" para carta/deságio fora do formato das colunas
 * (carta: até 13 inteiros e 2 casas; deságio: 1 inteiro e até 4 casas), mas a action repassava o texto cru e o Decimal aceitava
 * ".18", "1.8e-1" ou "2.5e5": o operador confirmava com "—" e a emissão acontecia. A action passa a recusar esses formatos com
 * mensagem fixa, ANTES de chamar o serviço. A faixa [0, 1] e o custo positivo continuam no serviço.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ incorporarCota: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({
  clearAdminCookie: vi.fn(), isAdminAuthenticated: vi.fn().mockResolvedValue(true), passwordMatches: vi.fn(), setAdminCookie: vi.fn(),
}));
vi.mock('@/lib/rate-limit/config', () => ({ adminLoginLimiter: { consume: vi.fn().mockResolvedValue(true), reset: vi.fn() } }));
vi.mock('@/lib/services/tokenizacao', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/tokenizacao')>()),
  incorporarCota: m.incorporarCota,
}));
vi.mock('@/lib/services/originacao', () => ({ registrarValidacaoLegal: vi.fn() }));

import { incorporarCotaAction } from '@/app/admin/actions';

const fd = (valorCarta?: string, desagio?: string) => {
  const f = new FormData();
  f.set('tipoBem', 'IMOVEL'); f.set('administradora', 'Adm');
  if (valorCarta !== undefined) f.set('valorCarta', valorCarta);
  if (desagio !== undefined) f.set('desagioAquisicao', desagio);
  return f;
};
const ERRO_CARTA = 'valor em reais inválido: use ponto como separador decimal, ex.: 250000.00, com até 13 inteiros e 2 casas';
const ERRO_DESAGIO = 'deságio inválido: use uma fração entre 0 e 1 com até 4 casas, ex.: 0.20 para 20%; não omita o zero inicial';

beforeEach(() => { m.incorporarCota.mockReset(); m.incorporarCota.mockResolvedValue({ txHash: 'tx' }); });

describe('incorporarCotaAction — formato de carta e deságio', () => {
  it.each(['.18', '00.18', '1.8e-1', '0.18000', '.5', '18e-2', ' 0.18', '0.18 ', '+0.18', '-0.1', '0,18', '5.', '', 'abc', '0x1'])(
    'deságio %j é recusado com mensagem fixa e o serviço NÃO é chamado',
    async (d) => {
      expect(await incorporarCotaAction(null, fd('250000', d))).toEqual({ ok: false, error: ERRO_DESAGIO });
      expect(m.incorporarCota).not.toHaveBeenCalled();
    },
  );
  it.each(['2.5e5', '250000.000', '.5', '+250000', '-1', ' 250000', '250000 ', '250.000,00', '10000000000000', '', 'abc'])(
    'carta %j é recusada com mensagem fixa e o serviço NÃO é chamado',
    async (v) => {
      expect(await incorporarCotaAction(null, fd(v, '0.18'))).toEqual({ ok: false, error: ERRO_CARTA });
      expect(m.incorporarCota).not.toHaveBeenCalled();
    },
  );
  it('campos ausentes também são recusados', async () => {
    expect(await incorporarCotaAction(null, fd(undefined, '0.18'))).toEqual({ ok: false, error: ERRO_CARTA });
    expect(await incorporarCotaAction(null, fd('250000', undefined))).toEqual({ ok: false, error: ERRO_DESAGIO });
    expect(m.incorporarCota).not.toHaveBeenCalled();
  });
  it.each([['250000', '0.18'], ['250000.5', '0'], ['250000.55', '0.1800'], ['8', '0.5'], ['9999999999999.99', '0.0001'], ['007', '1.5']])(
    'carta %s e deságio %s passam o formato e chegam ao serviço como vieram (a faixa é dele)',
    async (v, d) => {
      expect((await incorporarCotaAction(null, fd(v, d))).ok).toBe(true);
      expect(m.incorporarCota.mock.calls[0]![0]).toMatchObject({ valorCarta: v, desagioAquisicao: d });
    },
  );
});
