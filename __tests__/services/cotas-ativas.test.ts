/**
 * M15 (backlog de usabilidade 25/11): "Cotas ativas" do admin contava TODAS as cotas, inclusive REALIZADA/REVERTIDA (o
 * `cotas.length` do findMany sem filtro). "Ativa" já tem definição no sistema (o pool/summary conta DISPONIVEL + RESERVADA): fonte única.
 */
import { describe, expect, it } from 'vitest';
import { STATUS_COTA_ATIVA, contarCotasAtivas } from '@/lib/services/pool';

const c = (status: string) => ({ status }) as { status: never };

describe('cotas ativas', () => {
  it('a definição é DISPONIVEL + RESERVADA (a mesma do pool/summary)', () => {
    expect([...STATUS_COTA_ATIVA].sort()).toEqual(['DISPONIVEL', 'RESERVADA']);
  });
  it('realizadas e revertidas NÃO entram; as outras sim', () => {
    expect(contarCotasAtivas([c('DISPONIVEL'), c('RESERVADA'), c('REALIZADA'), c('REVERTIDA'), c('DISPONIVEL')])).toBe(3);
  });
  it('EMISSAO_PENDENTE (em desuso) também não conta como ativa', () => {
    expect(contarCotasAtivas([c('EMISSAO_PENDENTE'), c('DISPONIVEL')])).toBe(1);
  });
  it.each([[[]], [[c('REALIZADA')]], [[c('REVERTIDA'), c('REALIZADA')]]])('sem nenhuma ativa dá 0 (%j)', (lista) => {
    expect(contarCotasAtivas(lista)).toBe(0);
  });
  it('o pool/summary e o admin usam a MESMA lista (sem duplicar o literal)', async () => {
    const { readFileSync } = await import('node:fs');
    const resumo = readFileSync('app/api/pool/summary/route.ts', 'utf8');
    expect(resumo).toMatch(/STATUS_COTA_ATIVA/);
    expect(resumo).not.toMatch(/\['DISPONIVEL', 'RESERVADA'\]/);
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    expect(admin).toMatch(/contarCotasAtivas\(cotas\)/);
    expect(admin).not.toMatch(/label="Cotas ativas" value=\{String\(cotas\.length\)\}/);
  });
});
