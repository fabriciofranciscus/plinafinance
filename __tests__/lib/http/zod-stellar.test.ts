import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  stellarPubkey,
  stellarSignatureHex,
  stellarXdr,
} from '@/lib/http/zod-stellar';

describe('stellarPubkey', () => {
  it('aceita pubkey Ed25519 válida (G...)', () => {
    const pk = Keypair.random().publicKey();
    expect(stellarPubkey().safeParse(pk).success).toBe(true);
  });

  it('rejeita string malformada', () => {
    expect(stellarPubkey().safeParse('XINVALID').success).toBe(false);
  });
});

describe('stellarXdr', () => {
  it('aceita string base64 não-vazia', () => {
    expect(stellarXdr().safeParse('AAAA').success).toBe(true);
  });

  it('rejeita string vazia', () => {
    expect(stellarXdr().safeParse('').success).toBe(false);
  });

  it('respeita max custom', () => {
    expect(stellarXdr(4).safeParse('AAAAA').success).toBe(false);
  });
});

describe('stellarSignatureHex', () => {
  const hex128 = 'a'.repeat(128);

  it('aceita hex puro (sem prefixo)', () => {
    expect(stellarSignatureHex().safeParse(hex128).success).toBe(true);
  });

  // Regressão #35: Privy `useSignRawHash` devolve `{ signature: '0x...' }`.
  // Os 6 call sites do frontend (use-trustlines × 2, use-claim, use-swap,
  // sacar/page, minha-posicao/page) repassam isso direto pros submit
  // endpoints. PR #33 introduziu regex que rejeitava esse formato → 400
  // "body inválido" em trustlines, swap, claim, sacar e liquidar.
  it('aceita hex com prefixo 0x (formato Privy)', () => {
    expect(stellarSignatureHex().safeParse(`0x${hex128}`).success).toBe(true);
  });

  it('rejeita string vazia', () => {
    expect(stellarSignatureHex().safeParse('').success).toBe(false);
  });

  it('rejeita caracteres não-hex', () => {
    expect(stellarSignatureHex().safeParse('zz' + hex128).success).toBe(false);
  });

  it('rejeita acima do max (256)', () => {
    expect(stellarSignatureHex().safeParse('a'.repeat(257)).success).toBe(false);
  });
});
