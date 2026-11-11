import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';

type Row = Record<string, any>;
const ENV = '11111111-2222-4333-8444-555555555555';

const st = vi.hoisted(() => ({
  cessao: null as Row | null,
  audits: [] as Row[],
  lead: { status: 'OFERTA_ACEITA' } as Row,
  docStatus: 'concluido' as string,
  downloads: [] as Buffer[], // cada download devolve bytes DIFERENTES (como o DocuSign real)
  blob: new Map<string, Buffer>(),
  puts: 0,
  anchors: new Map<string, string>(), // hash → txHash
  ancorar: vi.fn(),
  falhaAncora: false,
  falhaPut: false,
  notify: vi.fn(),
}));

vi.mock('@/lib/email/notify-cedente', () => ({ notifyCedente: st.notify }));
vi.mock('@/lib/integrations/docusign', async (i) => {
  const actual = await i<typeof import('@/lib/integrations/docusign')>();
  return {
    ...actual,
    obterStatusEnvelope: vi.fn(async () => st.docStatus),
    baixarDocumentoAssinado: vi.fn(async () => {
      const b = Buffer.from(`%PDF-1.7 download ${st.downloads.length + 1} ${Math.random()}`);
      st.downloads.push(b);
      return b;
    }),
  };
});
vi.mock('@/lib/comprovante/cessao-store', () => ({
  lerCessaoAssinada: vi.fn(async (id: string) => st.blob.get(id) ?? null),
  guardarCessaoAssinada: vi.fn(async (id: string, b: Buffer) => {
    if (st.falhaPut) throw new Error('blob down');
    if (st.blob.has(id)) throw new Error('exists');
    st.puts++;
    st.blob.set(id, b);
    return `cessoes/${id}/assinada.pdf`;
  }),
}));
vi.mock('@/lib/services/ancora-sha256', () => ({
  buscarAncora: vi.fn(async (h: string) => (st.anchors.has(h) ? { txHash: st.anchors.get(h)! } : null)),
  ancorar: vi.fn(async (h: string) => {
    st.ancorar(h);
    if (st.falhaAncora) throw new Error('âncora down');
    const tx = `tx_${st.anchors.size + 1}`;
    st.anchors.set(h, tx);
    return { txHash: tx };
  }),
}));
vi.mock('@/lib/db', () => {
  const match = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return (v as Row[]).some((w) => match(row, w));
      if (v && typeof v === 'object' && !(v instanceof Date) && 'lt' in v) return row[k] != null && row[k] < v.lt;
      if (v && typeof v === 'object' && 'not' in v) return row[k] != null;
      return row[k] === v || (v === null && row[k] == null);
    });
  const cessao = {
    findFirst: async ({ where }: { where: Row }) => (st.cessao && match(st.cessao, where) ? { ...st.cessao, oferta: { leadVendedorId: 'lead_1', valorLiquidoVendedor: new Prisma.Decimal('80000'), leadVendedor: { email: 'a@example.com', nome: 'Ana' } } } : null),
    findMany: async ({ where }: { where: Row }) => (st.cessao && match(st.cessao, where) ? [{ id: st.cessao.id, docusignEnvelopeId: st.cessao.docusignEnvelopeId }] : []),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      if (!st.cessao || !match(st.cessao, where)) return { count: 0 };
      Object.assign(st.cessao, data);
      return { count: 1 };
    },
  };
  const eventoAudit = { create: async ({ data }: { data: Row }) => { st.audits.push(data); return data; } };
  const leadVendedor = { update: async ({ data }: { data: Row }) => { Object.assign(st.lead, data); } };
  return { db: { cessao, $transaction: async (fn: (t: unknown) => unknown) => fn({ cessao, eventoAudit, leadVendedor }) } };
});

import { CONCLUSAO_JANELA_MS, processarEnvelopeDocusign, sha256Hex, sincronizarCessoesDocusign } from '@/lib/services/cessao-assinatura';
import { POST } from '@/app/api/webhooks/docusign/route';

beforeEach(() => {
  st.cessao = { id: 'ces_1', ofertaId: 'of_1', status: 'ENVIADA_DOCUSIGN', docusignEnvelopeId: ENV, hashDocumento: null, onChainTxHash: null, docusignConclusaoIniciadaEm: null };
  st.audits = []; st.lead = { status: 'OFERTA_ACEITA' }; st.docStatus = 'concluido'; st.downloads = [];
  st.blob = new Map(); st.puts = 0; st.anchors = new Map(); st.ancorar.mockReset(); st.falhaAncora = false; st.falhaPut = false; st.notify.mockReset();
});

describe('DS3 — conclusão: PDF guardado → SHA-256 → memo → ASSINADA', () => {
  it('memo = SHA-256 do PDF GUARDADO (não de um 2º download): hash dos bytes guardados e âncora com esse hash', async () => {
    const r = await processarEnvelopeDocusign(ENV);
    expect(r.resultado).toBe('ASSINADA');
    const guardado = st.blob.get('ces_1')!;
    expect(r.hashDocumento).toBe(createHash('sha256').update(guardado).digest('hex'));
    expect(st.ancorar).toHaveBeenCalledWith(r.hashDocumento);
    expect(st.cessao).toMatchObject({ status: 'ASSINADA', hashDocumento: r.hashDocumento, onChainTxHash: r.txHash });
    expect(st.cessao!.assinadaEm).toBeInstanceOf(Date);
    expect(st.lead.status).toBe('CESSAO_ASSINADA');
    expect(st.audits[0]).toMatchObject({ acao: 'CESSAO_ASSINADA', payloadHash: r.hashDocumento, stellarTxHash: r.txHash });
    expect(st.notify).toHaveBeenCalledOnce();
    expect(st.downloads).toHaveLength(1);
  });

  it('um 2º download seria DIFERENTE: o hash ancorado nunca vem dele (retomada usa os bytes guardados)', async () => {
    st.falhaAncora = true;
    await expect(processarEnvelopeDocusign(ENV)).rejects.toThrow('âncora down'); // PDF e hash já guardados
    const hashGuardado = st.cessao!.hashDocumento!;
    expect(hashGuardado).toBe(sha256Hex(st.blob.get('ces_1')!));
    expect(st.cessao!.docusignConclusaoIniciadaEm).toBeNull(); // claim liberado

    st.falhaAncora = false;
    const r = await processarEnvelopeDocusign(ENV);
    expect(r.hashDocumento).toBe(hashGuardado);
    expect(st.downloads).toHaveLength(1); // NÃO baixou de novo
    expect(st.puts).toBe(1);
    expect(sha256Hex(Buffer.from('%PDF- outro download'))).not.toBe(hashGuardado);
  });

  it('crash depois de guardar o PDF e antes de gravar o hash: lê os bytes guardados e não baixa de novo', async () => {
    st.blob.set('ces_1', Buffer.from('%PDF-guardado'));
    const r = await processarEnvelopeDocusign(ENV);
    expect(r.hashDocumento).toBe(sha256Hex(Buffer.from('%PDF-guardado')));
    expect(st.downloads).toHaveLength(0);
    expect(st.puts).toBe(0);
  });

  it('crash depois de ancorar e antes de ASSINADA: acha a âncora pelo hash e NÃO ancora de novo', async () => {
    st.cessao!.hashDocumento = 'a'.repeat(64);
    st.blob.set('ces_1', Buffer.from('%PDF-x'));
    st.anchors.set('a'.repeat(64), 'tx_previa');
    const r = await processarEnvelopeDocusign(ENV);
    expect(r.txHash).toBe('tx_previa');
    expect(st.ancorar).not.toHaveBeenCalled();
    expect(st.cessao!.status).toBe('ASSINADA');
  });

  it('falha ao guardar o PDF: nada é ancorado nem marcado ASSINADA', async () => {
    st.falhaPut = true;
    await expect(processarEnvelopeDocusign(ENV)).rejects.toThrow('blob down');
    expect(st.ancorar).not.toHaveBeenCalled();
    expect(st.cessao!.status).toBe('ENVIADA_DOCUSIGN');
    expect(st.cessao!.hashDocumento).toBeNull();
  });

  it('reentrega do webhook depois de ASSINADA: duplicada, sem download nem âncora', async () => {
    await processarEnvelopeDocusign(ENV);
    st.downloads = []; st.ancorar.mockReset();
    const r = await processarEnvelopeDocusign(ENV);
    expect(r.resultado).toBe('JA_ASSINADA');
    expect(st.downloads).toHaveLength(0);
    expect(st.ancorar).not.toHaveBeenCalled();
    expect(st.audits).toHaveLength(1);
  });

  it('duas conclusões simultâneas: um claim só; a outra vê "em andamento" e ninguém ancora duas vezes', async () => {
    const [a, b] = await Promise.all([processarEnvelopeDocusign(ENV), processarEnvelopeDocusign(ENV)]);
    expect([a.resultado, b.resultado].sort()).toEqual(['ASSINADA', 'EM_ANDAMENTO']);
    expect([a.resultado, b.resultado]).toContain('ASSINADA');
    expect(st.ancorar).toHaveBeenCalledTimes(1);
    expect(st.puts).toBe(1);
  });

  it('claim velho (processo morreu) é assumido; claim recente bloqueia', async () => {
    st.cessao!.docusignConclusaoIniciadaEm = new Date();
    expect((await processarEnvelopeDocusign(ENV)).resultado).toBe('EM_ANDAMENTO');
    st.cessao!.docusignConclusaoIniciadaEm = new Date(Date.now() - CONCLUSAO_JANELA_MS - 1_000);
    expect((await processarEnvelopeDocusign(ENV)).resultado).toBe('ASSINADA');
  });

  it('envelope ainda não concluído (enviado/entregue/assinado): AGUARDANDO, sem baixar', async () => {
    for (const s of ['enviado', 'entregue', 'assinado']) {
      st.docStatus = s;
      expect((await processarEnvelopeDocusign(ENV)).resultado).toBe('AGUARDANDO');
    }
    expect(st.downloads).toHaveLength(0);
    expect(st.cessao!.status).toBe('ENVIADA_DOCUSIGN');
  });

  it('recusado/anulado: CANCELADA + audit, sem âncora', async () => {
    st.docStatus = 'recusado';
    expect((await processarEnvelopeDocusign(ENV)).resultado).toBe('CANCELADA');
    expect(st.cessao!.status).toBe('CANCELADA');
    expect(st.audits[0].acao).toBe('CESSAO_RECUSADA_DOCUSIGN');
    expect(st.ancorar).not.toHaveBeenCalled();
  });

  it('envelope desconhecido: DESCONHECIDA, nada acontece', async () => {
    expect((await processarEnvelopeDocusign('99999999-2222-4333-8444-555555555555')).resultado).toBe('DESCONHECIDA');
  });

  it('polling de fallback (/admin) reconcilia a cessão pendente; falha vira ERRO sem vazar a causa', async () => {
    const r = await sincronizarCessoesDocusign({ operador: 'adm' });
    expect(r).toEqual({ processadas: 1, resultados: [{ cessaoId: 'ces_1', resultado: 'ASSINADA' }] });
    st.cessao = { ...st.cessao!, status: 'ENVIADA_DOCUSIGN', hashDocumento: null, docusignConclusaoIniciadaEm: null };
    st.blob = new Map(); st.falhaPut = true;
    const r2 = await sincronizarCessoesDocusign({});
    expect(r2.resultados[0].resultado).toBe('ERRO');
    expect(JSON.stringify(r2)).not.toMatch(/blob down/);
  });
});

describe('DS3 — POST /api/webhooks/docusign', () => {
  const KEY = 'chave-connect-de-teste-0123456789';
  const body = JSON.stringify({ event: 'envelope-completed', data: { envelopeId: ENV } });
  const sig = (b: string, k = KEY) => createHmac('sha256', k).update(b).digest('base64');
  const req = (b: string, headers: Record<string, string> = {}) =>
    new Request('http://x/api/webhooks/docusign', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: b });

  beforeEach(() => { process.env.DOCUSIGN_CONNECT_HMAC_KEY = KEY; });

  it('HMAC válido → 200 e conclui a cessão', async () => {
    const r = await POST(req(body, { 'x-docusign-signature-1': sig(body) }));
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ received: true, resultado: 'ASSINADA' });
    expect(st.cessao!.status).toBe('ASSINADA');
  });

  it('reentrega → 200 JA_ASSINADA, sem reprocessar', async () => {
    await POST(req(body, { 'x-docusign-signature-1': sig(body) }));
    const r = await POST(req(body, { 'x-docusign-signature-1': sig(body) }));
    expect((await r.json()).data.resultado).toBe('JA_ASSINADA');
    expect(st.ancorar).toHaveBeenCalledTimes(1);
  });

  it('aceita a rotação de chave: basta UMA assinatura válida entre várias', async () => {
    const r = await POST(req(body, { 'x-docusign-signature-1': sig(body, 'outra'), 'x-docusign-signature-2': sig(body) }));
    expect(r.status).toBe(200);
  });

  it('sem assinatura / assinatura errada / corpo adulterado → 401 sem tocar em nada e sem ecoar o corpo', async () => {
    for (const h of [{} as Record<string, string>, { 'x-docusign-signature-1': sig(body, 'errada') }]) {
      const r = await POST(req(body, h));
      expect(r.status).toBe(401);
      expect(JSON.stringify(await r.json())).not.toContain(ENV);
    }
    const adulterado = body.replace('completed', 'completed ');
    expect((await POST(req(adulterado, { 'x-docusign-signature-1': sig(body) }))).status).toBe(401);
    expect(st.downloads).toHaveLength(0);
    expect(st.cessao!.status).toBe('ENVIADA_DOCUSIGN');
  });

  it('sem DOCUSIGN_CONNECT_HMAC_KEY → 503 fail-closed', async () => {
    delete process.env.DOCUSIGN_CONNECT_HMAC_KEY;
    expect((await POST(req(body, { 'x-docusign-signature-1': sig(body) }))).status).toBe(503);
  });

  it('assinado mas sem envelopeId / JSON inválido → 400', async () => {
    const sem = JSON.stringify({ foo: 1 });
    expect((await POST(req(sem, { 'x-docusign-signature-1': sig(sem) }))).status).toBe(400);
    expect((await POST(req('{nope', { 'x-docusign-signature-1': sig('{nope') }))).status).toBe(400);
  });

  it('o status do corpo NÃO vale: corpo diz "completed" mas a API diz "enviado" → AGUARDANDO', async () => {
    st.docStatus = 'enviado';
    const r = await POST(req(body, { 'x-docusign-signature-1': sig(body) }));
    expect((await r.json()).data.resultado).toBe('AGUARDANDO');
    expect(st.cessao!.status).toBe('ENVIADA_DOCUSIGN');
  });

  it('falha de processamento → 500 sem a mensagem (o Connect reentrega)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    st.falhaAncora = true;
    const r = await POST(req(body, { 'x-docusign-signature-1': sig(body) }));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/âncora down/);
  });
});
