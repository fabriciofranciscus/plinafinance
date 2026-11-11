import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  canonicalizeJson,
  verifyEtherfuseSignature,
  normalizeEtherfuseWebhook,
} from '@/lib/anchors/etherfuse/webhook';

const SECRET_B64 = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

function sign(body: unknown, secretB64 = SECRET_B64): string {
  const mac = createHmac('sha256', Buffer.from(secretB64, 'base64'))
    .update(canonicalizeJson(body))
    .digest('hex');
  return `sha256=${mac}`;
}

describe('canonicalizeJson (RFC 8785)', () => {
  it('ordena chaves e remove espaços', () => {
    expect(canonicalizeJson({ b: 1, a: { d: [1, { z: 2, y: 3 }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[1,{"y":3,"z":2}]},"b":1}',
    );
  });
  it('ordem das chaves não muda o resultado', () => {
    expect(canonicalizeJson({ a: 1, b: 2 })).toBe(canonicalizeJson({ b: 2, a: 1 }));
  });
});

describe('verifyEtherfuseSignature', () => {
  const body = { kyc_updated: { customerId: 'c1', status: 'approved', approved: true } };

  it('aceita assinatura válida sobre o corpo canônico (espaços/ordem irrelevantes)', () => {
    const raw = JSON.stringify(body, null, 2);
    expect(verifyEtherfuseSignature(raw, sign(body), SECRET_B64)).toBe(true);
  });

  it('aceita segredo base64 URL-safe', () => {
    const urlSafe = SECRET_B64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(verifyEtherfuseSignature(JSON.stringify(body), sign(body), urlSafe)).toBe(true);
  });

  it('recusa corpo adulterado', () => {
    const tampered = { kyc_updated: { ...body.kyc_updated, status: 'denied' } };
    expect(verifyEtherfuseSignature(JSON.stringify(tampered), sign(body), SECRET_B64)).toBe(false);
  });

  it('recusa segredo errado', () => {
    const other = Buffer.from('ffffffffffffffffffffffffffffffff').toString('base64');
    expect(verifyEtherfuseSignature(JSON.stringify(body), sign(body, other), SECRET_B64)).toBe(false);
  });

  it.each([null, '', 'sha256=zz', 'sha1=' + 'a'.repeat(64), 'a'.repeat(64)])(
    'recusa header ausente/malformado: %s',
    (h) => {
      expect(verifyEtherfuseSignature(JSON.stringify(body), h, SECRET_B64)).toBe(false);
    },
  );

  it('recusa JSON inválido e segredo vazio', () => {
    expect(verifyEtherfuseSignature('{nope', sign(body), SECRET_B64)).toBe(false);
    expect(verifyEtherfuseSignature(JSON.stringify(body), sign(body), '')).toBe(false);
  });
});

describe('normalizeEtherfuseWebhook', () => {
  it('kyc_updated: recurso = customerId, só campos allowlisted no payload', () => {
    const evt = normalizeEtherfuseWebhook({
      kyc_updated: {
        customerId: 'c1',
        status: 'in_progress',
        needsWork: true,
        userMessage: 'Reenvie o verso do documento',
        walletPublicKey: 'GABC',
        nome: 'Maria da Silva',
      },
    });
    expect(evt).toMatchObject({
      fornecedor: 'etherfuse',
      tipo: 'kyc_updated',
      recursoId: 'c1',
      status: 'in_progress',
      userMessage: 'Reenvie o verso do documento',
    });
    expect(Object.keys(evt!.payload).sort()).toEqual(['approved', 'needsWork', 'recursoId', 'status']);
    expect(JSON.stringify(evt!.payload)).not.toMatch(/Maria|GABC|Reenvie/);
  });

  it('eventoId é estável na reentrega e muda com o conteúdo', () => {
    const a = normalizeEtherfuseWebhook({ order_updated: { id: 'o1', status: 'funded' } });
    const b = normalizeEtherfuseWebhook({ order_updated: { status: 'funded', id: 'o1' } });
    const c = normalizeEtherfuseWebhook({ order_updated: { id: 'o1', status: 'completed' } });
    expect(a!.eventoId).toBe(b!.eventoId);
    expect(a!.eventoId).not.toBe(c!.eventoId);
  });

  it('usa eventId do envelope quando existe', () => {
    const evt = normalizeEtherfuseWebhook({ eventId: 'evt_9', kyc_updated: { customerId: 'c1', status: 'approved' } });
    expect(evt!.eventoId).toBe('evt_9');
  });

  it.each([null, [], 'x', {}, { foo: { id: 1 } }, { kyc_updated: 'x' }, { kyc_updated: [] }])(
    'devolve null para forma desconhecida: %j',
    (b) => {
      expect(normalizeEtherfuseWebhook(b)).toBeNull();
    },
  );
});
