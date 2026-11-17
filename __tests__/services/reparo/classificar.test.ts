/** T3 fatia 1: classificadores PUROS de cada saga (linha do banco + agora → estado e desde, ou null se não está parada). */
import { describe, expect, it } from 'vitest';
import {
  classificarCessao, classificarClawback, classificarIncorporacao, classificarOffRamp, classificarPix,
  classificarReservaOrfa, classificarSnapshotNav, PRAZOS_PROVISORIOS,
} from '@/lib/services/reparo/classificar';

const AGORA = new Date('2026-11-16T12:00:00Z');
const min = (n: number) => new Date(AGORA.getTime() - n * 60_000);

describe('classificarReservaOrfa (swap e resgate)', () => {
  it('reserva com hash, não consumida e maxTime vencido há > espera → RESERVA_ORFA desde o maxTime', () => {
    expect(classificarReservaOrfa({ submitXdrHash: 'h', consumedAt: null, submitMaxTime: min(30) }, AGORA)).toEqual({ estado: 'RESERVA_ORFA', desde: min(30) });
  });
  it('ainda dentro do prazo da tx, consumida ou sem hash → null (não está parada)', () => {
    expect(classificarReservaOrfa({ submitXdrHash: 'h', consumedAt: null, submitMaxTime: min(2) }, AGORA)).toBeNull();
    expect(classificarReservaOrfa({ submitXdrHash: 'h', consumedAt: min(5), submitMaxTime: min(30) }, AGORA)).toBeNull();
    expect(classificarReservaOrfa({ submitXdrHash: null, consumedAt: null, submitMaxTime: null }, AGORA)).toBeNull();
  });
});

describe('classificarPix', () => {
  const base = { status: 'PROCESSANDO' as const, criadoEm: min(60), temPagamento: false };
  it('INCERTO e FALHOU sempre; ENVIANDO/PROCESSANDO só depois de 30 min; COMPROVADA sem Pagamento', () => {
    expect(classificarPix({ ...base, status: 'INCERTO' }, AGORA)?.estado).toBe('INCERTO');
    expect(classificarPix({ ...base, status: 'FALHOU' }, AGORA)?.estado).toBe('FALHOU');
    expect(classificarPix({ ...base }, AGORA)?.estado).toBe('EM_TRANSITO_LONGO');
    expect(classificarPix({ ...base, status: 'COMPROVADA' }, AGORA)?.estado).toBe('COMPROVADA_SEM_PAGAMENTO');
  });
  it('em trânsito há menos de 30 min, ou COMPROVADA com Pagamento → null', () => {
    expect(classificarPix({ ...base, criadoEm: min(10) }, AGORA)).toBeNull();
    expect(classificarPix({ ...base, status: 'COMPROVADA', temPagamento: true }, AGORA)).toBeNull();
  });
});

describe('demais sagas', () => {
  it('OffRamp: pending sem burn há mais que o prazo → ORDEM_SEM_TRANSACAO; com burn ou recente → null', () => {
    expect(classificarOffRamp({ status: 'pending', burnStellarTxHash: null, criadoEm: min(120) }, AGORA)?.estado).toBe('ORDEM_SEM_TRANSACAO');
    expect(classificarOffRamp({ status: 'pending', burnStellarTxHash: 'tx', criadoEm: min(120) }, AGORA)).toBeNull();
    expect(classificarOffRamp({ status: 'pending', burnStellarTxHash: null, criadoEm: min(5) }, AGORA)).toBeNull();
    expect(classificarOffRamp({ status: 'completed', burnStellarTxHash: null, criadoEm: min(500) }, AGORA)).toBeNull();
  });
  it('Cessão: ENVIADA_DOCUSIGN antiga → AGUARDANDO_ASSINATURA; PENDENTE com claim de envio velho e sem envelope → ENVIO_PRESO', () => {
    expect(classificarCessao({ status: 'ENVIADA_DOCUSIGN', criadaEm: new Date(AGORA.getTime() - 5 * 24 * 3600_000), docusignEnvioIniciadoEm: null, docusignEnvelopeId: 'e' }, AGORA)?.estado).toBe('AGUARDANDO_ASSINATURA');
    expect(classificarCessao({ status: 'PENDENTE', criadaEm: min(90), docusignEnvioIniciadoEm: min(30), docusignEnvelopeId: null }, AGORA)?.estado).toBe('ENVIO_PRESO');
    expect(classificarCessao({ status: 'PENDENTE', criadaEm: min(90), docusignEnvioIniciadoEm: min(1), docusignEnvelopeId: null }, AGORA)).toBeNull();
    expect(classificarCessao({ status: 'ASSINADA', criadaEm: min(900), docusignEnvioIniciadoEm: null, docusignEnvelopeId: 'e' }, AGORA)).toBeNull();
  });
  it('Incorporação: PENDENTE com maxTime vencido; FALHOU; EXPIRADA; CONFIRMADA → null', () => {
    expect(classificarIncorporacao({ status: 'PENDENTE', maxTime: min(30) }, AGORA)?.estado).toBe('EMISSAO_PENDENTE');
    expect(classificarIncorporacao({ status: 'PENDENTE', maxTime: new Date(AGORA.getTime() + 60_000) }, AGORA)).toBeNull();
    expect(classificarIncorporacao({ status: 'FALHOU', maxTime: min(30) }, AGORA)?.estado).toBe('EMISSAO_FALHOU');
    expect(classificarIncorporacao({ status: 'EXPIRADA', maxTime: min(30) }, AGORA)?.estado).toBe('EMISSAO_EXPIRADA');
    expect(classificarIncorporacao({ status: 'CONFIRMADA', maxTime: min(30) }, AGORA)).toBeNull();
  });
  it('Snapshot: PUBLICANDO com lease vencido (ou sem lease e antigo) → PUBLICANDO_PRESO; PUBLICADO → null', () => {
    expect(classificarSnapshotNav({ status: 'PUBLICANDO', travaAte: min(20), criadoEm: min(60) }, AGORA)?.estado).toBe('PUBLICANDO_PRESO');
    expect(classificarSnapshotNav({ status: 'PUBLICANDO', travaAte: new Date(AGORA.getTime() + 60_000), criadoEm: min(60) }, AGORA)).toBeNull();
    expect(classificarSnapshotNav({ status: 'PUBLICADO', travaAte: null, criadoEm: min(600) }, AGORA)).toBeNull();
  });
  it('Clawback: attempting → TENTATIVA_SEM_CONCLUSAO, onchain → NA_REDE_SEM_REGISTRO, incerto → INCERTO (se antigos); executed/failed → null', () => {
    const ev = (status: string, criadoEm = min(30)) => ({ status, criadoEm });
    expect(classificarClawback(ev('attempting'), AGORA)?.estado).toBe('TENTATIVA_SEM_CONCLUSAO');
    expect(classificarClawback(ev('onchain'), AGORA)?.estado).toBe('NA_REDE_SEM_REGISTRO');
    expect(classificarClawback(ev('incerto'), AGORA)?.estado).toBe('INCERTO');
    expect(classificarClawback(ev('attempting', min(1)), AGORA)).toBeNull();
    expect(classificarClawback(ev('executed'), AGORA)).toBeNull();
    expect(classificarClawback(ev('failed'), AGORA)).toBeNull();
  });
  it('os prazos são PROVISÓRIOS e declarados (decisão c do desenho: Farol/Norma)', () => {
    expect(PRAZOS_PROVISORIOS.provisorio).toBe(true);
  });
});
