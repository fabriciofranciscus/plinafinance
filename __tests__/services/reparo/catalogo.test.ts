/** T3 fatia 1: catálogo de reparos (funções puras). Metadados de papel/step-up/valor vêm SÓ daqui (C2, Argus). */
import { describe, expect, it } from 'vitest';
import {
  ACOES_REPARO, CATALOGO_DE_REPAROS, TIPOS_OPERACAO, acoesPermitidas, entradaDoCatalogo, estadoDeOrigemValido,
} from '@/lib/services/reparo/catalogo';

describe('CATALOGO_DE_REPAROS', () => {
  it('cada par tipo × ação é único e usa só tipos e ações declarados', () => {
    const chaves = CATALOGO_DE_REPAROS.map((e) => `${e.tipo}:${e.acao}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    for (const e of CATALOGO_DE_REPAROS) {
      expect(TIPOS_OPERACAO).toContain(e.tipo);
      expect(ACOES_REPARO).toContain(e.acao);
    }
  });

  it('par fora do catálogo → undefined (a action recusa); par do catálogo → entrada', () => {
    expect(entradaDoCatalogo('PIX_SAIDA', 'REABRIR')).toBeDefined();
    expect(entradaDoCatalogo('PIX_SAIDA', 'CANCELAR_ORDEM')).toBeUndefined();
    expect(entradaDoCatalogo('CLAWBACK', 'REABRIR')).toBeUndefined();
  });

  it('C3 (Argus): REABRIR do Pix = APROVADOR + step-up + dupla aprovação SEMPRE, irreversível, com valor', () => {
    expect(entradaDoCatalogo('PIX_SAIDA', 'REABRIR')).toMatchObject({ papelMinimo: 'APROVADOR', stepUp: true, duplaAprovacao: true, irreversivel: true, semValor: false });
  });

  it('C3: CONSULTAR_REDE do clawback = APROVADOR + step-up; RETOMAR emissão e CANCELAR_ORDEM = OPERADOR + step-up', () => {
    expect(entradaDoCatalogo('CLAWBACK', 'CONSULTAR_REDE')).toMatchObject({ papelMinimo: 'APROVADOR', stepUp: true, semValor: false });
    expect(entradaDoCatalogo('INCORPORACAO', 'RETOMAR')).toMatchObject({ papelMinimo: 'OPERADOR', stepUp: true, efeitoOnChain: true, semValor: false });
    expect(entradaDoCatalogo('OFFRAMP', 'CANCELAR_ORDEM')).toMatchObject({ papelMinimo: 'OPERADOR', stepUp: true, semValor: false });
  });

  it('C3/C4: as 4 ações SEM valor são OPERADOR sem step-up e marcadas semValor (as únicas liberáveis antes do T1)', () => {
    const semValor = CATALOGO_DE_REPAROS.filter((e) => e.semValor).map((e) => `${e.tipo}:${e.acao}`).sort();
    expect(semValor).toEqual(['CESSAO:SINCRONIZAR', 'PIX_SAIDA:RECONSULTAR', 'RESGATE_ORFAO:RECONCILIAR', 'SNAPSHOT_NAV:RETOMAR', 'SWAP_ORFAO:RECONCILIAR']);
    for (const e of CATALOGO_DE_REPAROS.filter((x) => x.semValor)) {
      expect(e).toMatchObject({ papelMinimo: 'OPERADOR', stepUp: false, duplaAprovacao: false, irreversivel: false });
    }
  });

  it('toda ação com valor (semValor=false) exige step-up; irreversível exige step-up', () => {
    for (const e of CATALOGO_DE_REPAROS) {
      if (!e.semValor) expect(e.stepUp, `${e.tipo}:${e.acao}`).toBe(true);
      if (e.irreversivel) expect(e.stepUp, `${e.tipo}:${e.acao}`).toBe(true);
      if (e.duplaAprovacao) expect(e.papelMinimo).toBe('APROVADOR');
    }
  });
});

describe('estadoDeOrigem (funções puras)', () => {
  it('só os estados certos habilitam cada ação', () => {
    expect(estadoDeOrigemValido('PIX_SAIDA', 'REABRIR', 'FALHOU')).toBe(true);
    expect(estadoDeOrigemValido('PIX_SAIDA', 'REABRIR', 'INCERTO')).toBe(false); // incerto NÃO reabre: pode ter pago
    expect(estadoDeOrigemValido('PIX_SAIDA', 'REABRIR', 'EM_TRANSITO_LONGO')).toBe(false);
    expect(estadoDeOrigemValido('PIX_SAIDA', 'RECONSULTAR', 'INCERTO')).toBe(true);
    expect(estadoDeOrigemValido('PIX_SAIDA', 'RECONSULTAR', 'EM_TRANSITO_LONGO')).toBe(true);
    expect(estadoDeOrigemValido('SWAP_ORFAO', 'RECONCILIAR', 'RESERVA_ORFA')).toBe(true);
    expect(estadoDeOrigemValido('CESSAO', 'SINCRONIZAR', 'AGUARDANDO_ASSINATURA')).toBe(true);
    expect(estadoDeOrigemValido('CESSAO', 'SINCRONIZAR', 'ENVIO_PRESO')).toBe(false);
    expect(estadoDeOrigemValido('OFFRAMP', 'CANCELAR_ORDEM', 'ORDEM_SEM_TRANSACAO')).toBe(true);
    expect(estadoDeOrigemValido('CLAWBACK', 'CONSULTAR_REDE', 'INCERTO')).toBe(true);
    expect(estadoDeOrigemValido('CLAWBACK', 'CONSULTAR_REDE', 'NA_REDE_SEM_REGISTRO')).toBe(false); // retomável pelo MESMO pedido, não por reparo
  });
  it('estado desconhecido ou par fora do catálogo → false (nunca habilita por engano)', () => {
    expect(estadoDeOrigemValido('PIX_SAIDA', 'REABRIR', 'QUALQUER')).toBe(false);
    expect(estadoDeOrigemValido('CLAWBACK', 'REABRIR', 'FALHOU')).toBe(false);
  });
  it('acoesPermitidas(tipo, estado) lista as ações do catálogo para aquele estado', () => {
    expect(acoesPermitidas('PIX_SAIDA', 'FALHOU')).toEqual(['REABRIR']);
    expect(acoesPermitidas('PIX_SAIDA', 'INCERTO')).toEqual(['RECONSULTAR']);
    expect(acoesPermitidas('PIX_SAIDA', 'COMPROVADA_SEM_PAGAMENTO')).toEqual([]);
    expect(acoesPermitidas('CLAWBACK', 'NA_REDE_SEM_REGISTRO')).toEqual([]);
  });
});
