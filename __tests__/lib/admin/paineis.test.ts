import { describe, expect, it } from 'vitest';
import { PAINEIS_ORDEM, painelDoHash } from '@/lib/admin/paineis';

// AP-3 (spec da Íris §2): âncoras legadas continuam abrindo o painel certo; hash desconhecido cai em Solicitações.
describe('painelDoHash', () => {
  it('âncoras legadas abrem os respectivos painéis', () => {
    expect(painelDoHash('#overview')).toBe('overview');
    expect(painelDoHash('#vendedores')).toBe('vendedores');
    expect(painelDoHash('#compradores')).toBe('compradores');
    expect(painelDoHash('#cotas')).toBe('cotas');
    expect(painelDoHash('#investidores')).toBe('investidores');
    expect(painelDoHash('#audit')).toBe('audit');
    expect(painelDoHash('#incorporar')).toBe('incorporar');
  });
  it('#lead-<id> abre Solicitações', () => {
    expect(painelDoHash('#lead-cmlead0000a1b2c3')).toBe('vendedores');
  });
  it('vazio ou desconhecido cai em Solicitações, sem erro', () => {
    expect(painelDoHash('')).toBe('vendedores');
    expect(painelDoHash('#')).toBe('vendedores');
    expect(painelDoHash('#qualquer-coisa')).toBe('vendedores');
    expect(painelDoHash('#__proto__')).toBe('vendedores');
  });
  it('ordem da navegação: Solicitações, Compradores, Cotas, Investidores, Resumo, Auditoria, Avulsas', () => {
    expect(PAINEIS_ORDEM).toEqual(['vendedores', 'compradores', 'cotas', 'investidores', 'overview', 'audit', 'incorporar']);
  });
});
