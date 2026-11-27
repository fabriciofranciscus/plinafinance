/**
 * M17 (backlog de usabilidade 25/11): no /admin o NAV/token e o supply circulante falhavam EM SILÊNCIO (`.catch(() => null)`):
 * a tela mostrava "—" sem log e sem explicar. `lerSupplyParaPainel` nunca lança, REGISTRA a causa sem dado pessoal
 * (só classe do erro, nunca a mensagem) e devolve `indisponivel` para a tela dizer por que o campo está vazio.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lerSupplyParaPainel } from '@/lib/services/painel-supply';

const SUPPLY = { code: 'PLINARF', circulante: '100' } as never;
afterEach(() => vi.restoreAllMocks());

describe('lerSupplyParaPainel', () => {
  it('leitura ok: devolve o supply e não marca indisponível', async () => {
    const r = await lerSupplyParaPainel(async () => SUPPLY);
    expect(r).toEqual({ indisponivel: false, supply: SUPPLY });
  });
  it('falha: NÃO lança, devolve indisponível com o motivo fixo e supply null', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await lerSupplyParaPainel(async () => { throw new Error('Horizon caiu'); });
    expect(r).toEqual({ indisponivel: true, supply: null, motivo: 'LEITURA_FALHOU' });
  });
  it('falha: registra a causa (classe), nunca a mensagem do erro (pode ter URL, chave ou dado de terceiros)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await lerSupplyParaPainel(async () => { throw Object.assign(new Error('GSEGREDO https://horizon.test/accounts/GABC'), { name: 'NetworkError' }); });
    expect(log).toHaveBeenCalledTimes(1);
    const saida = JSON.stringify(log.mock.calls);
    expect(saida).toContain('NetworkError');
    expect(saida).not.toMatch(/GSEGREDO|horizon\.test|GABC/);
  });
  it('erro que não é Error (string solta) também não vaza nem lança', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await lerSupplyParaPainel(async () => { throw 'texto cru com segredo'; });
    expect(r.indisponivel).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain('segredo');
  });
  it('a página do admin usa o wrapper e não engole mais o erro com .catch(() => null)', async () => {
    const { readFileSync } = await import('node:fs');
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    expect(admin).toMatch(/lerSupplyParaPainel\(/);
    expect(admin).not.toMatch(/fetchSupplyOnChainFromEnv\(\)\.catch\(\(\) => null\)/);
  });
  it('a tela explica o "—": a nota aparece no NAV/token E no supply quando a leitura falha (e só então)', async () => {
    const { readFileSync } = await import('node:fs');
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    expect(admin).toMatch(/NOTA_SUPPLY_INDISPONIVEL = 'Não foi possível ler o supply/);
    const usos = admin.match(/nota=\{supplyIndisponivel \? NOTA_SUPPLY_INDISPONIVEL : undefined\}/g) ?? [];
    expect(usos).toHaveLength(2);
    expect(admin).toMatch(/role="status"/);
  });
});
