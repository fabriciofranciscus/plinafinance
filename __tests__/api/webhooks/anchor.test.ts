import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { canonicalizeJson } from '@/lib/anchors/etherfuse/webhook';

const { processar } = vi.hoisted(() => ({ processar: vi.fn() }));
vi.mock('@/lib/services/webhook-anchor', () => ({ processarWebhookAnchor: processar }));

import { POST } from '@/app/api/webhooks/anchor/route';

const SECRET = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const BODY = { kyc_updated: { customerId: 'c1', status: 'approved', approved: true } };

function sig(body: unknown, secret = SECRET) {
  return 'sha256=' + createHmac('sha256', Buffer.from(secret, 'base64')).update(canonicalizeJson(body)).digest('hex');
}
function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://x/api/webhooks/anchor', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANCHOR_WEBHOOK_SECRET = SECRET;
  processar.mockResolvedValue({ duplicado: false, processado: true });
});

describe('POST /api/webhooks/anchor', () => {
  it('200 com assinatura válida e processa', async () => {
    const r = await POST(req(BODY, { 'x-signature': sig(BODY) }));
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ received: true, duplicate: false });
    expect(processar).toHaveBeenCalledOnce();
  });

  it('reentrega: 200 duplicate', async () => {
    processar.mockResolvedValueOnce({ duplicado: true, processado: false });
    const r = await POST(req(BODY, { 'x-signature': sig(BODY) }));
    expect(r.status).toBe(200);
    expect((await r.json()).data.duplicate).toBe(true);
  });

  it('401 sem assinatura, sem tocar no banco', async () => {
    const r = await POST(req(BODY));
    expect(r.status).toBe(401);
    expect(processar).not.toHaveBeenCalled();
  });

  it('401 com assinatura de outro segredo ou corpo adulterado', async () => {
    const other = Buffer.from('ffffffffffffffffffffffffffffffff').toString('base64');
    expect((await POST(req(BODY, { 'x-signature': sig(BODY, other) }))).status).toBe(401);
    const tampered = { kyc_updated: { ...BODY.kyc_updated, status: 'denied' } };
    expect((await POST(req(tampered, { 'x-signature': sig(BODY) }))).status).toBe(401);
    expect(processar).not.toHaveBeenCalled();
  });

  it('401 não ecoa corpo nem segredo', async () => {
    const r = await POST(req(BODY));
    const text = JSON.stringify(await r.json());
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('customerId');
  });

  it('400 para evento assinado mas desconhecido', async () => {
    const weird = { foo: { id: 1 } };
    const r = await POST(req(weird, { 'x-signature': sig(weird) }));
    expect(r.status).toBe(400);
    expect(processar).not.toHaveBeenCalled();
  });

  it('503 fail-closed sem ANCHOR_WEBHOOK_SECRET', async () => {
    delete process.env.ANCHOR_WEBHOOK_SECRET;
    const r = await POST(req(BODY, { 'x-signature': sig(BODY) }));
    expect(r.status).toBe(503);
    expect(processar).not.toHaveBeenCalled();
  });

  it('413 para corpo acima do teto', async () => {
    const r = await POST(req('x'.repeat(300 * 1024), { 'x-signature': 'sha256=' + 'a'.repeat(64) }));
    expect(r.status).toBe(413);
  });

  it('falha no processamento vira 500 sem vazar mensagem (anchor reentrega)', async () => {
    processar.mockRejectedValueOnce(new Error('cpf 123.456.789-00'));
    const r = await POST(req(BODY, { 'x-signature': sig(BODY) }));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('123.456');
  });
});
