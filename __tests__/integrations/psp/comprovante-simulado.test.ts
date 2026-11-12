import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { COMPROVANTE_TIPO, mascararDestino, montarComprovante } from '@/lib/integrations/psp/comprovante';
import { criarSimuladoProvider } from '@/lib/integrations/psp/simulado';
import { obterPixProvider } from '@/lib/integrations/psp';
import { validarChavePix } from '@/lib/integrations/psp/types';

describe('mascararDestino', () => {
  it.each([
    ['CPF', '12345678901', 'CPF ***8901'],
    ['PHONE', '11999998877', 'PHONE ***8877'],
    ['EVP', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'EVP ***7890'],
    ['EMAIL', 'maria.silva@example.com.br', 'EMAIL m***@***.br'],
  ] as const)('%s', (tipo, chave, esperado) => {
    expect(mascararDestino(tipo, chave)).toBe(esperado);
  });
});

describe('mascararDestino — chave curta (F-E12-5)', () => {
  it('abaixo de 8 caracteres não mostra sufixo (nada de chave inteira)', () => {
    expect(mascararDestino('EVP', 'abc123')).toBe('EVP ***');
    expect(mascararDestino('PHONE', '1199')).toBe('PHONE ***');
  });
});

describe('validarChavePix', () => {
  it.each([
    ['CPF', '529.982.247-25', '52998224725'],
    ['CPF', '52998224725', '52998224725'],
    ['CNPJ', '11.222.333/0001-81', '11222333000181'],
    ['PHONE', '(11) 99999-8877', '11999998877'],
    ['EMAIL', ' Maria@Example.com ', 'maria@example.com'],
    ['EVP', 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
  ] as const)('%s válido e normalizado', (tipo, chave, esperado) => {
    expect(validarChavePix(tipo, chave)).toBe(esperado);
  });
  it.each([
    ['CPF', '52998224726'], ['CPF', '00000000000'], ['CPF', '1234'], ['CNPJ', '11222333000180'], ['CNPJ', '00000000000000'],
    ['PHONE', '0999998877'], ['PHONE', '5511999998877'], ['EMAIL', 'a@b'], ['EMAIL', 'a b@c.com'], ['EVP', 'não-é-uuid'],
  ] as const)('%s inválido (%s) → null', (tipo, chave) => {
    expect(validarChavePix(tipo, chave)).toBeNull();
  });
});

describe('montarComprovante', () => {
  const base = {
    provedor: 'ASAAS' as const, transferenciaId: 'tra_1', e2eId: 'E123', valor: '123.45',
    efetivadoEm: '2026-11-12T10:00:00.000Z', destino: 'CPF ***8901', cessaoId: 'cessao_1', referencia: 'pix-cedente:cessao_1',
  };
  it('JSON canônico: sha256 = SHA-256 dos bytes, chaves em ordem, sem espaço, valores como string', () => {
    const { bytes, sha256 } = montarComprovante(base);
    expect(sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    const txt = bytes.toString('utf8');
    expect(txt.startsWith('{"cessaoId":"cessao_1","destino":"CPF ***8901"')).toBe(true);
    expect(JSON.parse(txt)).toMatchObject({ tipo: COMPROVANTE_TIPO, versao: 1, valor: '123.45', moeda: 'BRL', e2eId: 'E123' });
  });
  it('determinístico: mesma entrada, mesmos bytes e mesmo hash; e2eId ausente = null', () => {
    expect(montarComprovante(base).sha256).toBe(montarComprovante({ ...base }).sha256);
    expect(JSON.parse(montarComprovante({ ...base, e2eId: null }).bytes.toString('utf8')).e2eId).toBeNull();
  });
  it('não tem lugar para a chave Pix: o arquivo só carrega o destino mascarado', () => {
    const txt = montarComprovante({ ...base, destino: mascararDestino('EMAIL', 'maria.silva@example.com.br') }).bytes.toString('utf8');
    expect(txt).not.toMatch(/maria|silva|example/);
  });
});

describe('provedor simulado e seletor', () => {
  const envio = { valor: '10.00', chavePix: 'x@y.com', tipoChave: 'EMAIL' as const, idempotencyKey: 'pix-cedente:abc12345' };
  it('conclui na hora com id determinístico; nunca "acha" transferência; recusa entrada inválida', async () => {
    const p = criarSimuladoProvider(() => new Date('2026-11-12T10:00:00Z'));
    const a = await p.enviarPix(envio);
    expect(a).toEqual(await p.enviarPix(envio));
    expect(a.status).toBe('CONCLUIDO');
    expect(await p.consultarStatus(a.id)).toMatchObject({ status: 'CONCLUIDO', efetivadoEm: '2026-11-12T10:00:00.000Z' });
    expect(await p.localizarPorChave('pix-cedente:abc12345', new Date())).toBeNull();
    await expect(p.enviarPix({ ...envio, valor: 'abc' })).rejects.toMatchObject({ code: 'PSP_RECUSOU' });
  });
  it('PSP_PROVIDER: padrão SIMULADO; ASAAS sem chave → PSP_CONFIG; valor desconhecido → PSP_CONFIG (não cai em outro)', () => {
    const antes = { p: process.env.PSP_PROVIDER, k: process.env.ASAAS_API_KEY };
    try {
      delete process.env.PSP_PROVIDER; delete process.env.ASAAS_API_KEY;
      expect(obterPixProvider().nome).toBe('SIMULADO');
      process.env.PSP_PROVIDER = 'asaas';
      expect(() => obterPixProvider()).toThrow(expect.objectContaining({ code: 'PSP_CONFIG' }));
      process.env.ASAAS_API_KEY = 'k'.repeat(20);
      expect(obterPixProvider().nome).toBe('ASAAS');
      process.env.PSP_PROVIDER = 'STARK';
      expect(() => obterPixProvider()).toThrow(expect.objectContaining({ code: 'PSP_CONFIG' }));
    } finally {
      for (const [k, v] of [['PSP_PROVIDER', antes.p], ['ASAAS_API_KEY', antes.k]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
    }
  });
});
