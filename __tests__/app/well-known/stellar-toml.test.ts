import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Z16 — stellar.toml público (SEP-1 v2.7.0, SEP-8). Texto: Norma,
 * contexto/landing-v1-correcao-ld0b.md §Z16. O arquivo é lido por explorers
 * e carteiras: nada de FIDC, CVM 175 ou "R$ 1,00 em NAV".
 */
const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { parametrosPool: { findUnique } } }));

import { GET } from '@/app/.well-known/stellar.toml/route';

// Parser TOML que o próprio @stellar/stellar-sdk usa para ler stellar.toml.
const toml = createRequire(require.resolve('@stellar/stellar-sdk'))('toml') as {
  parse: (s: string) => Record<string, unknown>;
};

const ISSUER = 'GDE7SOUNDSCNAFYX7XX7KIHRD4QBLORDNNBSGKM3JTQ7GP26NTQRI5UP';

async function servir() {
  const res = await GET();
  const body = await res.text();
  return { res, body, doc: toml.parse(body) };
}

function moeda(doc: Record<string, unknown>) {
  const lista = doc.CURRENCIES as Array<Record<string, unknown>>;
  expect(lista).toHaveLength(1);
  return lista[0];
}

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue({ issuerPubkey: ISSUER });
});

describe('GET /.well-known/stellar.toml', () => {
  it('devolve TOML válido, com CORS aberto e text/plain', async () => {
    const { res, doc } = await servir();
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(doc.NETWORK_PASSPHRASE).toBe('Test SDF Network ; September 2015');
  });

  it('não afirma FIDC, CVM 175, "R$ 1,00 em NAV", lastro nem "institucional" (nem em comentário)', async () => {
    const { body } = await servir();
    for (const proibido of [/FIDC/i, /CVM\s*175/i, /R\$\s*1,00/, /lastr/i, /institucional/i, /em NAV/i]) {
      expect(body).not.toMatch(proibido);
    }
  });

  it('textos da Norma (Z16) no DOCUMENTATION e na moeda', async () => {
    const { doc } = await servir();
    const docu = doc.DOCUMENTATION as Record<string, unknown>;
    expect(docu.ORG_DESCRIPTION).toBe(
      'Cotas contempladas de consórcio, com registro verificável na Stellar testnet. Projeto em desenvolvimento; sem oferta.',
    );
    const c = moeda(doc);
    expect(c.name).toBe('Plina · token de demonstração (testnet)');
    expect(c.desc).toMatch(
      /^Token de demonstração em rede de testes, sem valor financeiro real e não negociável\. Política de clawback pública em https:\/\/plina\.finance\/politica-clawback\./,
    );
    expect(c.desc).toMatch(/AUTH_REQUIRED — a conta passa pelo cadastro e KYC da Plina antes de receber trustline autorizada\./);
    expect(c.conditions).toBe(
      'Demonstração em testnet. Qualquer operação com valor real depende de aprovação regulatória e de documentação própria; não há oferta em andamento.',
    );
  });

  it('SEP-1: não é ativo ancorado nem regulado SEP-8; sem prova de reserva', async () => {
    const c = moeda((await servir()).doc);
    expect(c.code).toBe('PLINARF');
    expect(c.issuer).toBe(ISSUER);
    expect(c.status).toBe('test');
    expect(c.is_asset_anchored).toBe(false);
    expect(c).not.toHaveProperty('anchor_asset_type');
    expect(c).not.toHaveProperty('anchor_asset');
    expect(c).not.toHaveProperty('attestation_of_reserve');
    expect(c.regulated).toBe(false);
    expect(c).not.toHaveProperty('approval_server');
    expect(c).not.toHaveProperty('approval_criteria');
  });

  it('issuer cai para STELLAR_ISSUER_PUBLIC se o ParametrosPool ainda não existe', async () => {
    findUnique.mockResolvedValue(null);
    vi.stubEnv('STELLAR_ISSUER_PUBLIC', ISSUER);
    expect(moeda((await servir()).doc).issuer).toBe(ISSUER);
    vi.unstubAllEnvs();
  });
});
