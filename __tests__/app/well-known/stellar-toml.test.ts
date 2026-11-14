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
const DISTRIBUTOR = 'GA5NGV3RWPN7VLI7TG7BF6IBPWVMDNAO7HIRJWD3FKFOTAAKPJYCKMXB';

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
  vi.unstubAllEnvs();
  vi.stubEnv('STELLAR_ISSUER_PUBLIC', ISSUER);
  vi.stubEnv('STELLAR_DISTRIBUTOR_PUBLIC', DISTRIBUTOR);
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

describe('issuer de fonte única e falha fechada (Argus, Z16)', () => {
  const OUTRO = 'GBRG4JZ3ZB2T6P5AVL6K3PQLWQ3T2V7QOPZJ3XWKMTPKVPN7ZQ2CZKCF';

  it('o issuer vem só do env do deploy, mesmo que o banco diga outro', async () => {
    findUnique.mockResolvedValue({ issuerPubkey: OUTRO });
    expect(moeda((await servir()).doc).issuer).toBe(ISSUER);
    expect(findUnique).not.toHaveBeenCalled(); // GET público não consulta o banco
  });

  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['inválido', 'GISSUER'],
  ])('env %s → 500 sem toml, nunca CURRENCIES com issuer vazio', async (_nome, valor) => {
    if (valor === undefined) vi.stubEnv('STELLAR_ISSUER_PUBLIC', undefined as unknown as string);
    else vi.stubEnv('STELLAR_ISSUER_PUBLIC', valor);
    findUnique.mockResolvedValue({ issuerPubkey: ISSUER });

    const res = await GET();
    const body = await res.text();
    expect(res.status).toBe(500);
    expect(body).not.toMatch(/CURRENCIES|issuer\s*=/);
  });

  it('cache: navegador e CDN por até 5 min (explorers têm cache próprio, fora do nosso controle)', async () => {
    const { res } = await servir();
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
  });
});

describe('sem dados pessoais (Z16-b: Norma, LGPD; Argus, phishing; decisão da Thais)', () => {
  it('não publica [[PRINCIPALS]] nem e-mail nominal; só o endereço de função', async () => {
    const { body, doc } = await servir();
    expect(doc).not.toHaveProperty('PRINCIPALS');
    expect(body).not.toMatch(/\[\[PRINCIPALS\]\]/);
    expect(body).not.toMatch(/thais@|fabricio@|Thais Reis|Fabricio Santos/i);
    const emails = body.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [];
    expect(new Set(emails)).toEqual(new Set(['contato@plina.finance']));
  });
});

describe('supply (SEP-1: exatamente um entre is_unlimited, fixed_number, max_number)', () => {
  it('is_unlimited = true: o issuer pode emitir mais (decisão da Thais)', async () => {
    const c = moeda((await servir()).doc);
    expect(c.is_unlimited).toBe(true);
    expect(c).not.toHaveProperty('fixed_number');
    expect(c).not.toHaveProperty('max_number');
  });
});

describe('ACCOUNTS (S4 do Argus; SEP-1: contas controladas pelo domínio)', () => {
  it('lista exatamente o issuer e o distributor, ambos do env do deploy', async () => {
    const { doc } = await servir();
    expect(doc.ACCOUNTS).toEqual([ISSUER, DISTRIBUTOR]);
  });

  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['inválido', 'GDIST'],
  ])('distributor %s → 500 sem toml', async (_n, valor) => {
    vi.stubEnv('STELLAR_DISTRIBUTOR_PUBLIC', valor as unknown as string);
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/ACCOUNTS|CURRENCIES/);
  });
});
