import { describe, expect, it } from 'vitest';
import { TEXTO_INCERTO, interpretarErroDeAcao } from '@/lib/admin/erro-acao';

describe('interpretarErroDeAcao (checklist do item 14)', () => {
  it('código conhecido: mensagem da API + código; nenhum outro campo vaza', () => {
    const e = interpretarErroDeAcao(409, { error: 'Envio recusado: falta o laudo.', code: 'LAUDO_AUSENTE', detalhe: 'segredo' });
    expect(e).toEqual({ texto: 'Envio recusado: falta o laudo.', codigo: 'LAUDO_AUSENTE', incerto: false });
    expect(JSON.stringify(e)).not.toContain('segredo');
  });
  it('422 do deságio (A-22): lê body.error mesmo sem code', () => {
    expect(interpretarErroDeAcao(422, { error: 'Deságio total acima de 100%.' })).toEqual({ texto: 'Deságio total acima de 100%.', codigo: null, incerto: false });
  });
  it('503 DOCUSIGN_*: mensagem pronta do servidor', () => {
    expect(interpretarErroDeAcao(503, { error: 'O DocuSign não está configurado neste ambiente.', code: 'DOCUSIGN_NAO_CONFIGURADO' })).toMatchObject({ codigo: 'DOCUSIGN_NAO_CONFIGURADO', incerto: false });
  });
  it('401, 403 e 429 têm texto próprio; 429 respeita Retry-After e não inventa espera', () => {
    expect(interpretarErroDeAcao(401, { error: 'x' }).texto).toBe('Sessão expirada. Entre novamente para continuar.');
    expect(interpretarErroDeAcao(403, {}).texto).toBe('Acesso não autorizado.');
    expect(interpretarErroDeAcao(429, {}, '12').texto).toBe('Muitas tentativas. Aguarde 12 s e tente de novo.');
    expect(interpretarErroDeAcao(429, {}, null).texto).toBe('Muitas tentativas. Aguarde um momento e tente de novo.');
  });
  it('401 não afirma "ação não enviada"', () => {
    expect(interpretarErroDeAcao(401, {}).texto).not.toMatch(/não enviada|não foi enviada/i);
  });
  it('500 e rede (status 0): resultado incerto, conferir antes de repetir', () => {
    expect(interpretarErroDeAcao(500, { error: 'erro interno' })).toEqual({ texto: TEXTO_INCERTO, codigo: null, incerto: true });
    expect(interpretarErroDeAcao(0, null).incerto).toBe(true);
  });
  it('4xx sem mensagem: texto genérico com o status', () => {
    expect(interpretarErroDeAcao(400, {}).texto).toBe('Falha ao executar a ação (HTTP 400).');
  });
});

import { avisoDeResposta } from '@/lib/admin/erro-acao';

describe('avisoDeResposta: 200 que não é o passo concluído (mapa §4.5)', () => {
  it('sincronizar: assinada = sem aviso; aguardando, cancelada, erro e desconhecida avisam; sem pendentes avisa', () => {
    expect(avisoDeResposta('sincronizar-cessoes', { resultados: [{ resultado: 'ASSINADA' }] })).toBeNull();
    expect(avisoDeResposta('sincronizar-cessoes', { resultados: [{ resultado: 'JA_ASSINADA' }] })).toBeNull();
    expect(avisoDeResposta('sincronizar-cessoes', { resultados: [{ resultado: 'AGUARDANDO' }] })).toMatch(/ainda não assinou/);
    expect(avisoDeResposta('sincronizar-cessoes', { resultados: [{ resultado: 'EM_ANDAMENTO' }] })).toMatch(/ainda não assinou/);
    expect(avisoDeResposta('sincronizar-cessoes', { resultados: [{ resultado: 'CANCELADA' }] })).toMatch(/cancelada/);
    expect(avisoDeResposta('sincronizar-cessoes', { resultados: [{ resultado: 'ERRO' }] })).toMatch(/Não foi possível consultar/);
    expect(avisoDeResposta('sincronizar-cessoes', { resultados: [{ resultado: 'DESCONHECIDA' }] })).toMatch(/desconhecido/);
    expect(avisoDeResposta('sincronizar-cessoes', { processadas: 0, resultados: [] })).toMatch(/Nenhuma cessão pendente/);
  });
  it('pagar: só COMPROVADA é pago; PROCESSANDO/INCERTO/FALHOU avisam e nunca mandam repetir o pagamento', () => {
    expect(avisoDeResposta('pagar-cedente', { status: 'COMPROVADA' })).toBeNull();
    expect(avisoDeResposta('pagar-cedente', { status: 'PROCESSANDO' })).toMatch(/não paga de novo/);
    expect(avisoDeResposta('pagar-cedente', { status: 'INCERTO' })).toMatch(/não repita o pagamento/);
    expect(avisoDeResposta('pagar-cedente', { status: 'FALHOU' })).toMatch(/Reabrir pagamento/);
  });
  it('outras ações não geram aviso', () => {
    expect(avisoDeResposta('registrar-laudo', { ok: true })).toBeNull();
    expect(avisoDeResposta('enviar-cessao', { jaEnviada: true })).toBeNull();
  });
});
