import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

type Row = Record<string, any>;

const st = vi.hoisted(() => ({
  cessoes: new Map<string, Row>(),
  oferta: null as Row | null,
  audits: [] as Row[],
  envelopes: new Map<string, string>(), // transactionId → envelopeId (lado DocuSign)
  criar: [] as Array<{ transactionId: string; pdf: Buffer; email: string }>,
  busca: [] as string[],
  script: [] as Array<'OK' | 'INCERTO_CRIADO' | 'INCERTO_NAO_CRIADO' | 'REJEITADO'>,
  memo: vi.fn(),
  notify: vi.fn(),
  rede: 'TESTNET' as string,
  laudo: 'b'.repeat(64) as string | null,
}));

vi.mock('@/lib/stellar/audit', () => ({
  buildAuditPayload: vi.fn(),
  registerOnChainHash: st.memo,
}));
vi.mock('@/lib/email/notify-cedente', () => ({ notifyCedente: st.notify }));
vi.mock('@/lib/stellar/config', async (i) => {
  const mod = { ...(await i<typeof import('@/lib/stellar/config')>()) } as Record<string, unknown>;
  Object.defineProperty(mod, 'STELLAR_NETWORK', { get: () => st.rede, enumerable: true });
  return mod;
});

vi.mock('@/lib/integrations/docusign', async () => {
  const { DocusignError } = await import('@/lib/integrations/docusign/errors');
  const { transactionIdDeterministico } = await import('@/lib/integrations/docusign/transaction-id');
  return {
    DocusignError,
    transactionIdDeterministico,
    buscarEnvelopePorTransactionId: vi.fn(async (t: string) => {
      st.busca.push(t);
      return st.envelopes.get(t) ?? null;
    }),
    criarEnvelope: vi.fn(async (e: { transactionId: string; documentoPdf: Buffer; signatario: { email: string } }) => {
      await Promise.resolve();
      st.criar.push({ transactionId: e.transactionId, pdf: e.documentoPdf, email: e.signatario.email });
      const out = st.script.shift() ?? 'OK';
      if (out === 'REJEITADO') throw new DocusignError('REQUISICAO_REJEITADA', 'rejeitada');
      // reenvio sequencial com a mesma transactionId devolve o MESMO envelope (medido no sandbox)
      const id = st.envelopes.get(e.transactionId) ?? `00000000-0000-4000-8000-${String(st.envelopes.size + 1).padStart(12, '0')}`;
      if (out !== 'INCERTO_NAO_CRIADO') st.envelopes.set(e.transactionId, id);
      if (out.startsWith('INCERTO')) throw new DocusignError('RESULTADO_INCERTO', 'incerto');
      return { envelopeId: id };
    }),
  };
});

vi.mock('@/lib/db', () => {
  const match = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return (v as Row[]).some((w) => match(row, w));
      if (v && typeof v === 'object' && !(v instanceof Date) && 'lt' in v) return row[k] != null && row[k] < v.lt;
      if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
      return row[k] === v || (v === null && row[k] == null);
    });
  const cessao = {
    findUnique: async ({ where, include }: { where: Row; include?: Row }) => {
      const r = [...st.cessoes.values()].find((c) => match(c, where));
      if (!r) return null;
      return include ? { ...r, oferta: st.oferta } : { ...r };
    },
    findUniqueOrThrow: async ({ where }: { where: Row }) => {
      const r = [...st.cessoes.values()].find((c) => match(c, where));
      if (!r) throw new Error('nf');
      return { ...r };
    },
    create: async ({ data }: { data: Row }) => {
      if ([...st.cessoes.values()].some((c) => c.ofertaId === data.ofertaId)) {
        throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
      }
      const row = { id: `ces_${st.cessoes.size + 1}`, status: 'PENDENTE', docusignEnvelopeId: null, docusignEnvioIniciadoEm: null, ...data };
      st.cessoes.set(row.id, row);
      return { ...row };
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const r of st.cessoes.values()) if (match(r, where)) { Object.assign(r, data); count++; }
      return { count };
    },
  };
  const eventoAudit = {
    create: async ({ data }: { data: Row }) => { st.audits.push(data); return data; },
    findFirst: async () => (st.laudo ? { payloadHash: st.laudo } : null), // laudo registrado (COTA_VALIDADA)
  };
  return {
    db: {
      oferta: { findUnique: async () => (st.oferta ? { ...st.oferta, cessao: [...st.cessoes.values()][0] ?? null } : null) },
      cessao,
      $transaction: async (fn: (t: unknown) => unknown) => fn({ cessao, eventoAudit }),
      eventoAudit,
    },
  };
});

import { registrarCessao } from '@/lib/services/originacao';
import {
  DOCUSIGN_ENVIO_JANELA_MS,
  EnvioDocusignEmAndamentoError,
  enviarCessaoParaAssinatura,
  transactionIdDaCessao,
} from '@/lib/services/cessao-docusign';
import { DocusignError } from '@/lib/integrations/docusign/errors';

beforeEach(() => {
  st.cessoes = new Map(); st.audits = []; st.envelopes = new Map(); st.criar = []; st.busca = []; st.script = [];
  st.memo.mockReset(); st.notify.mockReset(); st.rede = 'TESTNET'; st.laudo = 'b'.repeat(64);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  st.oferta = {
    id: 'of_1', status: 'ACEITA', leadVendedorId: 'lead_1', administradora: 'Porto Seguro', tipoBem: 'VEICULO',
    valorCarta: new Prisma.Decimal('100000'), desagioAquisicao: new Prisma.Decimal('0.2'),
    valorLiquidoVendedor: new Prisma.Decimal('80000'),
    leadVendedor: { nome: 'Ana Teste', email: 'ana@example.com' },
  };
});

const input = { ofertaId: 'of_1', operador: 'adm' };

describe('DS2 — registrarCessao envia ao DocuSign', () => {
  it('grava ENVIADA_DOCUSIGN com o envelopeId e NENHUM memo on-chain (sem notificar "assinada")', async () => {
    const r = await registrarCessao(input);
    expect(r).toMatchObject({ status: 'ENVIADA_DOCUSIGN', jaEnviada: false });
    const c = [...st.cessoes.values()][0];
    expect(c).toMatchObject({ status: 'ENVIADA_DOCUSIGN', docusignEnvelopeId: r.envelopeId });
    expect(c.hashDocumento ?? null).toBeNull();
    expect(c.onChainTxHash ?? null).toBeNull();
    expect(c.assinadaEm ?? null).toBeNull();
    expect(st.memo).not.toHaveBeenCalled(); // nenhum memo neste passo
    expect(st.notify).not.toHaveBeenCalled();
    expect(st.audits).toHaveLength(1);
    expect(st.audits[0]).toMatchObject({ acao: 'CESSAO_ENVIADA_DOCUSIGN', cessaoId: c.id });
    expect(st.audits[0].payloadHash).toBeUndefined();
    expect(st.audits[0].stellarTxHash).toBeUndefined();
  });

  it('o envelope leva PDF válido, transactionId determinístico da cessão e o e-mail do cedente (só ao DocuSign)', async () => {
    await registrarCessao(input);
    expect(st.criar).toHaveLength(1);
    expect(st.criar[0].pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(st.criar[0].transactionId).toBe(transactionIdDaCessao('ces_1'));
    expect(st.criar[0].email).toBe('ana@example.com');
    expect(JSON.stringify(st.audits)).not.toMatch(/ana@example|Ana Teste/); // sem PII no audit
  });

  it('reenvio (2ª chamada sequencial) NÃO cria 2º envelope e devolve o mesmo', async () => {
    const a = await registrarCessao(input);
    const b = await registrarCessao(input);
    expect(b).toMatchObject({ envelopeId: a.envelopeId, status: 'ENVIADA_DOCUSIGN', jaEnviada: true });
    expect(st.criar).toHaveLength(1);
    expect(st.envelopes.size).toBe(1);
    expect(st.audits).toHaveLength(1);
  });

  it('chamadas CONCORRENTES: um envelope só; as outras recebem o envelope ou "em andamento"', async () => {
    const rs = await Promise.allSettled([registrarCessao(input), registrarCessao(input), registrarCessao(input)]);
    expect(st.criar).toHaveLength(1);
    expect(st.envelopes.size).toBe(1);
    expect(st.cessoes.size).toBe(1);
    for (const r of rs) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(EnvioDocusignEmAndamentoError);
    }
    expect(rs.some((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('oferta que não está ACEITA é recusada sem criar cessão nem envelope', async () => {
    st.oferta!.status = 'ENVIADA';
    await expect(registrarCessao(input)).rejects.toThrow(/ACEITA/);
    expect(st.cessoes.size).toBe(0);
    expect(st.criar).toHaveLength(0);
  });

  it('cedente sem e-mail: recusa antes de chamar o DocuSign', async () => {
    st.oferta!.leadVendedor.email = '';
    await expect(registrarCessao(input)).rejects.toThrow(/e-mail/);
    expect(st.criar).toHaveLength(0);
  });
});

describe('DS2 — resposta incerta e envio que morreu', () => {
  it('RESULTADO_INCERTO com envelope criado: acha por transactionId, grava e não cria outro', async () => {
    st.script = ['INCERTO_CRIADO'];
    const r = await registrarCessao(input);
    expect(r.status).toBe('ENVIADA_DOCUSIGN');
    expect(st.criar).toHaveLength(1);
    expect(st.busca).toEqual([transactionIdDaCessao('ces_1')]);
    expect(st.envelopes.size).toBe(1);
  });

  it('RESULTADO_INCERTO sem envelope achado: erro, cessão continua PENDENTE e a próxima chamada consulta ANTES de reenviar', async () => {
    st.script = ['INCERTO_NAO_CRIADO', 'OK'];
    await expect(registrarCessao(input)).rejects.toBeInstanceOf(DocusignError);
    const c = [...st.cessoes.values()][0];
    expect(c.status).toBe('PENDENTE');
    expect(c.docusignEnvioIniciadoEm).not.toBeNull(); // marca velha: próximo assume já, consultando antes
    st.busca = [];
    const r = await registrarCessao(input);
    expect(st.busca).toEqual([transactionIdDaCessao('ces_1')]); // consulta prévia, antes do reenvio
    expect(st.criar).toHaveLength(2); // o reenvio só ocorreu porque a consulta não achou nada
    expect(r.status).toBe('ENVIADA_DOCUSIGN');
    expect(st.envelopes.size).toBe(1);
  });

  it('erro definitivo (rejeitado): libera o claim e a nova tentativa pode reenviar na hora', async () => {
    st.script = ['REJEITADO', 'OK'];
    await expect(registrarCessao(input)).rejects.toMatchObject({ codigo: 'REQUISICAO_REJEITADA' });
    expect([...st.cessoes.values()][0].docusignEnvioIniciadoEm).toBeNull();
    const r = await registrarCessao(input);
    expect(r.status).toBe('ENVIADA_DOCUSIGN');
    expect(st.envelopes.size).toBe(1);
  });

  it('envio em curso (marca recente) bloqueia outro chamador; marca velha (processo morreu) é assumida, consultando antes', async () => {
    await registrarCessao({ ...input }).catch(() => undefined); // cria a cessão e envia
    // volta a cessão ao estado "claim em curso, sem envelope"
    const c = [...st.cessoes.values()][0];
    const envId = c.docusignEnvelopeId;
    Object.assign(c, { status: 'PENDENTE', docusignEnvelopeId: null, docusignEnvioIniciadoEm: new Date(Date.now()) });
    await expect(enviarCessaoParaAssinatura({ cessaoId: c.id, operador: 'adm' })).rejects.toBeInstanceOf(EnvioDocusignEmAndamentoError);
    // marca velha: assume, acha o envelope que o processo morto já criou (mesma transactionId) e NÃO cria outro
    c.docusignEnvioIniciadoEm = new Date(Date.now() - DOCUSIGN_ENVIO_JANELA_MS - 5_000);
    st.criar = [];
    const r = await enviarCessaoParaAssinatura({ cessaoId: c.id, operador: 'adm' });
    expect(r.envelopeId).toBe(envId);
    expect(st.criar).toHaveLength(0);
  });
});

describe('DS2 — laudo antes do envelope, em QUALQUER rede (Vera F-DS2-1; Atlas 13/11)', () => {
  it.each(['PUBLIC', 'TESTNET'])('%s sem laudo: recusa ANTES do claim e do DocuSign (nada criado, nenhum envelope)', async (rede) => {
    st.rede = rede;
    st.laudo = null;
    await expect(registrarCessao(input)).rejects.toMatchObject({ code: 'LAUDO_AUSENTE' });
    expect(st.criar).toHaveLength(0);
    expect(st.busca).toHaveLength(0);
    const c = [...st.cessoes.values()][0];
    expect(c?.docusignEnvioIniciadoEm ?? null).toBeNull(); // sem claim
    expect(c?.status ?? 'PENDENTE').toBe('PENDENTE');
  });

  it.each(['PUBLIC', 'TESTNET'])('%s com laudo registrado: envia normalmente', async (rede) => {
    st.rede = rede;
    const r = await registrarCessao(input);
    expect(r.status).toBe('ENVIADA_DOCUSIGN');
    expect(st.criar).toHaveLength(1);
  });

  it('registrarCessao({ enviar: false }) só cria a cessão PENDENTE: nenhum DocuSign, nem sem laudo', async () => {
    st.laudo = null;
    const r = await registrarCessao({ ...input, enviar: false });
    expect(r).toMatchObject({ status: 'PENDENTE', envelopeId: null, jaEnviada: false });
    expect(st.criar).toHaveLength(0);
    expect(st.busca).toHaveLength(0);
    expect([...st.cessoes.values()]).toHaveLength(1);
  });

  it('depois do laudo, enviarCessaoParaAssinatura envia a cessão criada com enviar:false (sem 2ª cessão)', async () => {
    st.laudo = null;
    const criada = await registrarCessao({ ...input, enviar: false });
    await expect(enviarCessaoParaAssinatura({ cessaoId: criada.cessaoId, operador: 'adm' })).rejects.toMatchObject({ code: 'LAUDO_AUSENTE' });
    st.laudo = 'b'.repeat(64); // laudo registrado
    const r = await enviarCessaoParaAssinatura({ cessaoId: criada.cessaoId, operador: 'adm' });
    expect(r.status).toBe('ENVIADA_DOCUSIGN');
    expect([...st.cessoes.values()]).toHaveLength(1);
    expect(st.criar).toHaveLength(1);
  });
});
