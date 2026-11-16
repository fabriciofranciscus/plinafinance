import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildAuditPayload, stableSerialize } from '@/lib/stellar/audit';
import { bytesCanonicos } from '@/lib/services/json-canonico';
import {
  operadorEhFuncao,
  prepararIncorporacao,
  prepararValidacao,
  varreduraPII,
} from '../../scripts/evidencia-cota/registros-canonicos';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const PESSOA = { nomes: ['Fulana de Tal Silva', 'Fulana Silva'], documentos: ['12345678909'], emails: ['fulana@exemplo.test'] };
const TX = 'a'.repeat(64);

// payload do laudo: o MESMO que registrarLaudoDaCessao monta (sem dado de pessoa)
const payloadLaudo = () =>
  buildAuditPayload('cota_validacao', 'cessao_1', {
    cessaoId: 'cessao_1',
    laudoUrl: 'https://mwswxgx46zpxboei.public.blob.vercel-storage.com/evidencias-demo/laudo-de-demonstracao.pdf#sha256=' + 'b'.repeat(64),
    administradora: 'Administradora Demonstração (fictícia)',
    tipoBem: 'IMOVEL',
    operador: 'admin-panel',
  });
const registroIncorp = () => ({
  tipo: 'COTA_INCORPORADA', versao: 1, cotaId: 'inc_1', cessaoId: 'cessao_1', hashLaudo: 'c'.repeat(64),
  sha256PdfCessao: 'd'.repeat(64), comprovantePixSha256: 'e'.repeat(64), comprovantePixAncoraTxHash: 'f'.repeat(64),
  valorIncorporadoBrl: '31200.00', tokensEmitir: '31200.0000000', navPorTokenUsado: '1.00000000', issuer: 'GISS', asset: 'PLINARF',
});

describe('varreduraPII (condição P1 do Argus)', () => {
  it('texto limpo → tudo zero', () => {
    expect(varreduraPII('{"administradora":"Administradora Demonstração (fictícia)","valor":"31200.00"}', PESSOA)).toEqual({ cpf: 0, email: 0, telefone: 0, nome: 0, documentoDoCedente: 0, total: 0 });
  });
  it('acha CPF (com e sem máscara), e-mail, telefone BR e o nome do cedente (sem diferenciar maiúscula/acento)', () => {
    const r = varreduraPII('cpf 123.456.789-09 e 98765432100; mail a@b.co; tel (11) 98765-4321; FULANA DE TAL SILVA', PESSOA);
    expect(r.cpf).toBeGreaterThanOrEqual(2);
    expect(r.email).toBe(1);
    expect(r.telefone).toBeGreaterThanOrEqual(1);
    expect(r.nome).toBe(1);
    expect(r.total).toBeGreaterThan(0);
  });
  it('acha o documento do cedente mesmo sem máscara e o e-mail do cedente', () => {
    expect(varreduraPII('x 12345678909 y', PESSOA).documentoDoCedente).toBe(1);
    expect(varreduraPII('x fulana@exemplo.test y', PESSOA).email).toBe(1);
  });
  it('hashes de 64 hex e ids NÃO viram falso positivo de CPF/telefone', () => {
    const t = JSON.stringify({ h: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90', id: 'inc_557c91c71eb8f0157b15ea5182042cc5', tx: '9'.repeat(64), valor: '387400.0000000' });
    expect(varreduraPII(t, { nomes: [], documentos: [], emails: [] }).total).toBe(0);
  });
  it('nome muito curto (<4 letras) não entra na busca, para não acusar texto comum', () => {
    expect(varreduraPII('ana maria bia', { nomes: ['Ana', 'Bia'], documentos: [], emails: [] }).nome).toBe(0);
  });
});

describe('operadorEhFuncao: lista FECHADA de funções conhecidas (um regex não distingue "thais" de uma função)', () => {
  it.each(['admin-panel', 'docusign', 'etherfuse-anchor', 'investidor-self-service', 'self-service'])('%s é identificador de função', (o) => expect(operadorEhFuncao(o)).toBe(true));
  it.each(['maria@exemplo.com', 'Maria da Silva', 'thais', 'fabricio', '', 'A B', 'fulana.silva@x', 'admin-panel2', 'Admin-Panel'])('%j não é (vai para revisão manual)', (o) => expect(operadorEhFuncao(o)).toBe(false));
});

describe('prepararValidacao: os bytes são os da serialização que gerou o hash', () => {
  it('bytes = stableSerialize(payload); sha256 = hash da cota = hash do evento; sem PII → pronto', () => {
    const p = payloadLaudo();
    const hash = sha(stableSerialize(p));
    const r = prepararValidacao({ cota: { hashValidacao: hash, validacaoTxHash: TX }, laudo: { payloadJson: JSON.parse(JSON.stringify(p)), payloadHash: hash } }, PESSOA);
    expect(r.ok).toBe(true);
    expect(r.sha256).toBe(hash);
    expect(r.bytes!.toString('utf8')).toBe(stableSerialize(p));
    expect(r.memoEsperadoDe).toBe(TX);
    expect(r.nomeDoArquivo).toBe(`registro-validacao-${hash.slice(0, 8)}.json`);
  });
  it('hash recalculado ≠ hash registrado → recusa (não publica arquivo que não fecha)', () => {
    const p = payloadLaudo();
    const r = prepararValidacao({ cota: { hashValidacao: 'f'.repeat(64), validacaoTxHash: TX }, laudo: { payloadJson: p, payloadHash: 'f'.repeat(64) } }, PESSOA);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/HASH_DIVERGE/);
  });
  it('payloadHash do evento ≠ hashValidacao da cota → recusa', () => {
    const p = payloadLaudo();
    const h = sha(stableSerialize(p));
    const r = prepararValidacao({ cota: { hashValidacao: h, validacaoTxHash: TX }, laudo: { payloadJson: p, payloadHash: '0'.repeat(64) } }, PESSOA);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/REGISTRO_DIVERGE/);
  });
  it('payload com o nome do cedente → recusa por PII (e não imprime o nome)', () => {
    const p = { ...payloadLaudo(), administradora: 'Fulana de Tal Silva' };
    const h = sha(stableSerialize(p));
    const r = prepararValidacao({ cota: { hashValidacao: h, validacaoTxHash: TX }, laudo: { payloadJson: p, payloadHash: h } }, PESSOA);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/PII/);
    expect(JSON.stringify(r)).not.toMatch(/Fulana/);
  });
  it('operador que é pessoa (e-mail) → recusa', () => {
    const p = { ...payloadLaudo(), operador: 'maria@exemplo.com' };
    const h = sha(stableSerialize(p));
    const r = prepararValidacao({ cota: { hashValidacao: h, validacaoTxHash: TX }, laudo: { payloadJson: p, payloadHash: h } }, { nomes: [], documentos: [], emails: [] });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/OPERADOR_NAO_E_FUNCAO|PII/);
  });
  it('sem laudo no banco → recusa', () => {
    expect(prepararValidacao({ cota: { hashValidacao: 'a'.repeat(64), validacaoTxHash: TX }, laudo: null }, PESSOA).motivo).toMatch(/SEM_LAUDO/);
  });
});

describe('prepararIncorporacao: bytes = RFC 8785 do registro; hash = payloadHash = memo', () => {
  it('pronto quando sha256(bytes) = payloadHash gravado e não há PII', () => {
    const reg = registroIncorp();
    const bytes = bytesCanonicos(reg);
    const hash = sha(bytes);
    const r = prepararIncorporacao({ cota: { id: 'inc_1' }, incorporacao: { payloadJson: { registroCanonico: reg, ancoraTxHash: TX }, payloadHash: hash } }, PESSOA);
    expect(r.ok).toBe(true);
    expect(r.sha256).toBe(hash);
    expect(Buffer.compare(r.bytes!, bytes)).toBe(0); // exatamente os bytes canônicos, sem reformatar
    expect(r.memoEsperadoDe).toBe(TX);
    expect(r.nomeDoArquivo).toBe(`registro-incorporacao-${hash.slice(0, 8)}.json`);
  });
  it('payloadHash gravado ≠ sha256 dos bytes → recusa', () => {
    const r = prepararIncorporacao({ cota: { id: 'inc_1' }, incorporacao: { payloadJson: { registroCanonico: registroIncorp(), ancoraTxHash: TX }, payloadHash: '1'.repeat(64) } }, PESSOA);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/HASH_DIVERGE/);
  });
  it('sem registro canônico ou sem tx da âncora → recusa', () => {
    expect(prepararIncorporacao({ cota: { id: 'inc_1' }, incorporacao: { payloadJson: {}, payloadHash: 'a'.repeat(64) } }, PESSOA).motivo).toMatch(/SEM_REGISTRO/);
    const reg = registroIncorp();
    expect(prepararIncorporacao({ cota: { id: 'inc_1' }, incorporacao: { payloadJson: { registroCanonico: reg }, payloadHash: sha(bytesCanonicos(reg)) } }, PESSOA).motivo).toMatch(/SEM_TX/);
  });
  it('registro com campo de pessoa (ex.: nome) → recusa por PII', () => {
    const reg = { ...registroIncorp(), observacao: 'cedente Fulana de Tal Silva' };
    const r = prepararIncorporacao({ cota: { id: 'inc_1' }, incorporacao: { payloadJson: { registroCanonico: reg, ancoraTxHash: TX }, payloadHash: sha(bytesCanonicos(reg)) } }, PESSOA);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/PII/);
  });
});

import { conferirMemoNaRede } from '../../scripts/evidencia-cota/registros-canonicos';

describe('conferirMemoNaRede (P2: só se publica se sha256(arquivo) = Memo.hash)', () => {
  const H = 'https://horizon.exemplo.test';
  const resp = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });
  const memoDe = (hex: string) => Buffer.from(hex, 'hex').toString('base64');
  const SHA = 'ab'.repeat(32);
  const fetchCom = (r: Response | Error) => (async () => { if (r instanceof Error) throw r; return r; }) as unknown as typeof fetch;

  it('tx bem-sucedida com memo do tipo hash igual ao sha256 → ok (e lê a URL certa)', async () => {
    let url = '';
    const f = (async (u: string) => { url = u; return resp({ successful: true, memo_type: 'hash', memo: memoDe(SHA) }); }) as unknown as typeof fetch;
    expect(await conferirMemoNaRede(f, H, TX, SHA)).toEqual({ ok: true });
    expect(url).toBe(`${H}/transactions/${TX}`);
  });
  it.each([
    ['memo diferente', resp({ successful: true, memo_type: 'hash', memo: memoDe('cd'.repeat(32)) }), /MEMO_DIVERGE/],
    ['tx falhou na rede', resp({ successful: false, memo_type: 'hash', memo: memoDe(SHA) }), /TX_FALHOU/],
    ['sem memo do tipo hash', resp({ successful: true, memo_type: 'text', memo: 'x' }), /SEM_MEMO_HASH/],
    ['tx inexistente', resp({}, 404), /TX_NAO_ENCONTRADA/],
    ['Horizon 503', resp({}, 503), /HORIZON_503/],
  ])('%s → recusa', async (_n, r, motivo) => {
    expect((await conferirMemoNaRede(fetchCom(r), H, TX, SHA)).motivo).toMatch(motivo);
  });
  it('rede fora do ar → recusa (nunca "conferiu")', async () => {
    expect((await conferirMemoNaRede(fetchCom(new Error('ECONNRESET')), H, TX, SHA)).motivo).toBe('REDE_INDISPONIVEL');
  });
  it('hash de tx inválido → recusa sem chamar a rede', async () => {
    let chamou = false;
    const f = (async () => { chamou = true; return resp({}); }) as unknown as typeof fetch;
    expect((await conferirMemoNaRede(f, H, '../x', SHA)).motivo).toBe('TX_INVALIDA');
    expect(chamou).toBe(false);
  });
});
