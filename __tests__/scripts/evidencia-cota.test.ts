import { describe, expect, it } from 'vitest';
import { memoHashDaIncorporacao } from '@/lib/services/tokenizacao';
import { sha256OfPayload } from '@/lib/stellar/audit';
import { dec, memoDaIncorporacao, montarEvidencia, paraMarkdown, sha256Hex, type Fontes, type TxLida } from '../../scripts/evidencia-cota/core';

const TX = (n: string) => n.repeat(64).slice(0, 64);
const PDF = Buffer.from('%PDF-1.7 cessao assinada');
const COMP = Buffer.from('%PDF-1.7 comprovante psp');
const LAUDO = { parecer: 'ok', cota: 'c1' };
const H_LAUDO = sha256OfPayload(LAUDO);
const MEMO_EMISSAO = memoDaIncorporacao('cessao1');
const ISSUER = 'GISSUER'.padEnd(56, 'A');
const REGISTRO = Buffer.from(JSON.stringify({ cotaId: 'c1', cessaoId: 'cessao1', valor: '100.00', navPorToken: '1.00000000', quantidade: '10', issuer: ISSUER }));
const PAG_EMISSAO = [{ asset: `PLINARF:${ISSUER}`, amount: '10.0000000', from: ISSUER, to: 'GPLINA' }];
// ordem no ledger: âncora (0100) antes da emissão (0200); demais passos irrelevantes.
const ORDEM: Record<string, string> = { [TX('e')]: '100', [TX('d')]: '200' };

/** Mundo feliz; cada teste sobrescreve UMA coisa. */
function mundo(over: Partial<Fontes> = {}, memos: Record<string, string | null> = {}): Fontes {
  const m: Record<string, string | null> = {
    [TX('a')]: H_LAUDO, [TX('b')]: sha256Hex(PDF), [TX('c')]: sha256Hex(COMP), [TX('d')]: MEMO_EMISSAO, ...memos,
  };
  const f: Fontes = {
    hashPayload: sha256OfPayload,
    ativo: () => ({ code: 'PLINARF', issuer: ISSUER }),
    registroIncorporacao: async () => ({ bytes: REGISTRO, hashRegistrado: sha256Hex(REGISTRO), txHash: TX('e') }),
    cota: async () => ({ id: 'c1', cessaoId: 'cessao1', hashValidacao: H_LAUDO, validacaoTxHash: TX('a'), emissaoTxHash: TX('d'), tokensEmitidos: '10' }),
    laudo: async () => ({ payloadJson: LAUDO, payloadHash: H_LAUDO }),
    cessao: async () => ({ status: 'ASSINADA', hashDocumento: sha256Hex(PDF), onChainTxHash: TX('b') }),
    pdfCessao: async () => PDF,
    pagamento: async () => ({ status: 'EXECUTADO', onChainTxHash: TX('c'), hashComprovante: sha256Hex(COMP) }),
    comprovante: async () => COMP,
    aporte: async () => ({ txHash: TX('d'), hashValidacao: H_LAUDO, valorBrl: '100.00', navPorToken: '1.00000000' }),
    tx: async (h): Promise<TxLida | null> => {
      // a âncora do registro carrega sha256 dos bytes que o mundo guarda (muda junto com o registro do caso)
      const memoE = sha256Hex((await f.registroIncorporacao('c1'))?.bytes ?? Buffer.alloc(0));
      const memo = h === TX('e') ? memoE : m[h];
      return h in m || h === TX('e') ? { sucesso: true, memoHex: memo, ordem: ORDEM[h], pagamentos: h === TX('d') ? PAG_EMISSAO : [] } : null;
    },
  };
  return Object.assign(f, over);
}
const run = (f: Fontes) => montarEvidencia('c1', f, () => new Date('2026-11-14T12:00:00Z'));
const passo = (e: Awaited<ReturnType<typeof run>>, id: string) => e.passos.find((p) => p.passo === id)!;

const regBytes = (bytes: Buffer, tx = TX('e')) => ({ bytes, hashRegistrado: sha256Hex(bytes), txHash: tx });
/** Registro com UM campo alterado; o mundo ancora o hash dos bytes alterados, então só o conteúdo diverge. */
const reg = (mudanca: Record<string, unknown>) => regBytes(Buffer.from(JSON.stringify({ ...JSON.parse(REGISTRO.toString()), ...mudanca })));


describe('E1-P evidencia:cota', () => {
  it('a fórmula do memo de emissão é a de produção (trava deriva)', () => {
    expect(memoDaIncorporacao('x')).toBe(memoHashDaIncorporacao('x').toString('hex'));
  });

  it('cota íntegra: 5 passos na ordem, todos conferem, com link do explorer', async () => {
    const e = await run(mundo());
    expect(e.passos.map((p) => p.passo)).toEqual(['VALIDACAO', 'CESSAO', 'LIQUIDACAO', 'INCORPORACAO', 'EMISSAO']);
    expect(e.todosConferem).toBe(true);
    expect(passo(e, 'CESSAO').explorerUrl).toBe(`https://stellar.expert/explorer/testnet/tx/${TX('b')}`);
    expect(paraMarkdown(e)).toContain('TODOS CONFEREM');
  });

  it('PDF diferente do que foi ancorado (2º download) reprova a cessão', async () => {
    const e = await run(mundo({ pdfCessao: async () => Buffer.from('%PDF outro download') }));
    expect(passo(e, 'CESSAO')).toMatchObject({ confere: false });
    expect(passo(e, 'CESSAO').motivo).toMatch(/DOCUMENTO_DIVERGE/);
    expect(e.todosConferem).toBe(false);
  });

  it('memo on-chain ≠ hash do documento reprova (banco certo, chain errada)', async () => {
    const e = await run(mundo({}, { [TX('b')]: sha256Hex('adulterado') }));
    expect(passo(e, 'CESSAO').motivo).toMatch(/MEMO_DIVERGE/);
  });

  const casos: [string, Partial<Fontes>, string, RegExp][] = [
    ['cessão sem PDF guardado', { pdfCessao: async () => null }, 'CESSAO', /SEM_DOCUMENTO/],
    ['liquidação sem comprovante guardado', { comprovante: async () => null }, 'LIQUIDACAO', /SEM_DOCUMENTO/],
    ['cessão sem tx on-chain', { cessao: async () => ({ status: 'ASSINADA', hashDocumento: sha256Hex(PDF), onChainTxHash: null }) }, 'CESSAO', /SEM_TX/],
    ['cessão sem hash no banco', { cessao: async () => ({ status: 'ASSINADA', hashDocumento: null, onChainTxHash: TX('b') }) }, 'CESSAO', /SEM_HASH_REGISTRADO/],
    ['cessão não assinada', { cessao: async () => ({ status: 'ENVIADA_DOCUSIGN', hashDocumento: sha256Hex(PDF), onChainTxHash: TX('b') }) }, 'CESSAO', /NAO_ASSINADA/],
    ['laudo ausente', { laudo: async () => null }, 'VALIDACAO', /SEM_DOCUMENTO/],
    ['laudo adulterado no banco', { laudo: async () => ({ payloadJson: { parecer: 'outro' }, payloadHash: H_LAUDO }) }, 'VALIDACAO', /DOCUMENTO_DIVERGE/],
    ['aporte ausente', { aporte: async () => null }, 'INCORPORACAO', /SEM_APORTE/],
    ['registro da incorporação inexistente', { registroIncorporacao: async () => null }, 'INCORPORACAO', /SEM_REGISTRO_INCORPORACAO/],
    ['registro sem âncora (tx null)', { registroIncorporacao: async () => ({ bytes: REGISTRO, hashRegistrado: sha256Hex(REGISTRO), txHash: null }) }, 'INCORPORACAO', /SEM_TX/],
    ['registro sem hash no banco', { registroIncorporacao: async () => ({ bytes: REGISTRO, hashRegistrado: null, txHash: TX('e') }) }, 'INCORPORACAO', /SEM_HASH_REGISTRADO/],
    ['registro guardado ≠ o ancorado (bytes trocados)', { registroIncorporacao: async () => ({ bytes: Buffer.from(JSON.stringify({ cotaId: 'c1', adulterado: 1 })), hashRegistrado: sha256Hex(REGISTRO), txHash: TX('e') }) }, 'INCORPORACAO', /DOCUMENTO_DIVERGE/],
    ['registro de outra cota', { registroIncorporacao: async () => reg({ cotaId: 'c9' }) }, 'INCORPORACAO', /OUTRA_COTA/],
    ['registro com valor diferente do aporte', { registroIncorporacao: async () => reg({ valor: '99.99' }) }, 'INCORPORACAO', /valor ≠ aporte/],
    ['registro com NAV diferente do aporte', { registroIncorporacao: async () => reg({ navPorToken: '2' }) }, 'INCORPORACAO', /navPorToken/],
    ['registro com quantidade ≠ tokens emitidos', { registroIncorporacao: async () => reg({ quantidade: '11' }) }, 'INCORPORACAO', /quantidade/],
    ['registro com emissor errado', { registroIncorporacao: async () => reg({ issuer: 'GOUTRO' }) }, 'INCORPORACAO', /issuer/],
    ['registro sem campo obrigatório', { registroIncorporacao: async () => reg({ navPorToken: undefined }) }, 'INCORPORACAO', /INCOMPLETO/],
    ['registro que não é JSON', { registroIncorporacao: async () => regBytes(Buffer.from('nao json')) }, 'INCORPORACAO', /NAO_E_JSON/],
    ['comprovante sobrescrito depois da âncora (hash do banco ≠ bytes de hoje)', { pagamento: async () => ({ status: 'EXECUTADO', onChainTxHash: TX('c'), hashComprovante: sha256Hex('comprovante original') }) }, 'LIQUIDACAO', /DOCUMENTO_DIVERGE/],
    ['emissão sem payment de PLINARF do emissor', { tx: async (h): Promise<TxLida | null> => (h === TX('d') ? { sucesso: true, memoHex: MEMO_EMISSAO, ordem: '200', pagamentos: [{ asset: 'XLM:G', amount: '10', from: ISSUER, to: 'G' }] } : h === TX('e') ? { sucesso: true, memoHex: sha256Hex(REGISTRO), ordem: '100', pagamentos: [] } : null) }, 'EMISSAO', /PAGAMENTO_EMISSAO_DIVERGE/],
    ['emissão com valor diferente de tokensEmitidos', { cota: async () => ({ id: 'c1', cessaoId: 'cessao1', hashValidacao: H_LAUDO, validacaoTxHash: TX('a'), emissaoTxHash: TX('d'), tokensEmitidos: '9' }) }, 'EMISSAO', /PAGAMENTO_EMISSAO_DIVERGE/],
    ['aporte em outra tx', { aporte: async () => ({ txHash: TX('x'), hashValidacao: H_LAUDO, valorBrl: '100.00', navPorToken: '1.00000000' }) }, 'INCORPORACAO', /FORA_DA_TX/],
    ['aporte sem o laudo', { aporte: async () => ({ txHash: TX('d'), hashValidacao: sha256Hex('x'), valorBrl: '100.00', navPorToken: '1.00000000' }) }, 'INCORPORACAO', /SEM_O_LAUDO/],
  ];
  it.each(casos)('reprova: %s', async (_n, over, id, motivo) => {
    const e = await run(mundo(over));
    expect(passo(e, id).confere).toBe(false);
    expect(passo(e, id).motivo).toMatch(motivo);
    expect(e.todosConferem).toBe(false);
  });

  it('a âncora do registro DEPOIS (ou junto) da emissão reprova; sem ordem no ledger também (falha fechada)', async () => {
    const comOrdem = (ordem: string | undefined) => {
      const f = mundo();
      const orig = f.tx;
      f.tx = async (h) => { const t = await orig(h); return h === TX('e') && t ? { ...t, ordem } : t; };
      return f;
    };
    expect(passo(await run(comOrdem('300')), 'INCORPORACAO').motivo).toMatch(/ANCORA_NAO_ANTES/);
    expect(passo(await run(comOrdem('200')), 'INCORPORACAO').motivo).toMatch(/ANCORA_NAO_ANTES/); // mesma posição = não provou "antes"
    expect(passo(await run(comOrdem(undefined)), 'INCORPORACAO').motivo).toMatch(/ORDEM_INDETERMINADA/);
    expect(passo(await run(comOrdem('150')), 'INCORPORACAO').confere).toBe(true);
  });

  it('tx falha no ledger ou inexistente reprova', async () => {
    const falha = await run(mundo({ tx: async (h) => ({ sucesso: h !== TX('d'), memoHex: MEMO_EMISSAO }) }));
    expect(passo(falha, 'EMISSAO').motivo).toMatch(/TX_FALHOU/);
    const nada = await run(mundo({ tx: async () => null }));
    expect(passo(nada, 'VALIDACAO').motivo).toMatch(/TX_NAO_ENCONTRADA/);
  });

  it('tx sem Memo.hash reprova', async () => {
    const e = await run(mundo({}, { [TX('d')]: null }));
    expect(passo(e, 'EMISSAO').motivo).toMatch(/SEM_MEMO_HASH/);
  });

  it('erro de rede do Horizon PROPAGA (nunca vira "passo sem prova" silencioso)', async () => {
    await expect(run(mundo({ tx: async () => { throw new Error('Horizon 503'); } }))).rejects.toThrow('Horizon 503');
  });

  it('cota inexistente falha alto; cota sem cessão marca o motivo', async () => {
    await expect(run(mundo({ cota: async () => null }))).rejects.toThrow(/não encontrada/);
    const e = await run(mundo({ cota: async () => ({ id: 'c1', cessaoId: null, hashValidacao: H_LAUDO, validacaoTxHash: TX('a'), emissaoTxHash: TX('d'), tokensEmitidos: '1' }) }));
    expect(passo(e, 'CESSAO').motivo).toMatch(/COTA_SEM_CESSAO/);
    expect(e.todosConferem).toBe(false);
  });

  it('a emissão cobra a chave certa: cessaoId quando há cessão, senão hashValidacao', async () => {
    const semCessao = mundo({
      cota: async () => ({ id: 'c1', cessaoId: null, hashValidacao: H_LAUDO, validacaoTxHash: TX('a'), emissaoTxHash: TX('d'), tokensEmitidos: '10' }),
      registroIncorporacao: async () => regBytes(Buffer.from(JSON.stringify({ ...JSON.parse(REGISTRO.toString()), cessaoId: null }))),
    }, { [TX('d')]: memoDaIncorporacao(H_LAUDO) });
    expect(passo(await run(semCessao), 'EMISSAO').confere).toBe(true);
  });
});

describe('dec (decimal canônico)', () => {
  it('trata 100, 100.00 e 100.0000000 como iguais e recusa lixo', () => {
    expect(dec('100')).toBe('100');
    expect(dec('100.00')).toBe('100');
    expect(dec('1.50')).toBe('1.5');
    expect(dec('0.0000001')).toBe('0.0000001');
    expect(dec('abc')).toBeNull();
    expect(dec(null)).toBeNull();
  });
});

describe('E1-P sobre a main 4f337e8 (D5 do Atlas)', () => {
  const runP = (f: Fontes, pend: ('CESSAO' | 'INCORPORACAO')[]) =>
    montarEvidencia('c1', f, () => new Date('2026-11-14T12:00:00Z'), { pendentesNestaBase: pend });

  it('liquidação mostra o endToEndId do PSP junto do SHA-256 do comprovante', async () => {
    const f = mundo({ pagamento: async () => ({ status: 'COMPROVADA', onChainTxHash: TX('c'), hashComprovante: sha256Hex(COMP), e2eId: 'E1234567820261113120000ABCDEF12' }) });
    const p = passo(await run(f), 'LIQUIDACAO');
    expect(p.confere).toBe(true);
    expect(p.documento).toContain('endToEndId E1234567820261113120000ABCDEF12');
  });

  it('liquidação com transferência ainda não comprovada não confere', async () => {
    const f = mundo({ pagamento: async () => ({ status: 'INCERTO', onChainTxHash: TX('c'), hashComprovante: sha256Hex(COMP) }) });
    expect(passo(await run(f), 'LIQUIDACAO').motivo).toMatch(/LIQUIDACAO_NAO_COMPROVADA/);
  });

  it('cessão sem nenhum artefato do DS3 e marcada como pendente nesta base → PENDENTE, não falha', async () => {
    const f = mundo({
      cessao: async () => ({ status: 'PENDENTE', hashDocumento: null, onChainTxHash: null }),
      pdfCessao: async () => null,
    });
    const e = await runP(f, ['CESSAO']);
    expect(passo(e, 'CESSAO')).toMatchObject({ confere: false, pendente: true });
    expect(passo(e, 'CESSAO').motivo).toMatch(/^PENDENTE/);
    expect(e.todosConferem).toBe(false);
    expect(e.conferemExcetoPendentes).toBe(true);
    expect(paraMarkdown(e)).toMatch(/pendente/i);
  });

  it('pendente NÃO mascara prova quebrada: com artefato parcial do DS3 o passo é conferido e reprova', async () => {
    const f = mundo({ pdfCessao: async () => Buffer.from('outro pdf') });
    const e = await runP(f, ['CESSAO']);
    expect(passo(e, 'CESSAO')).toMatchObject({ confere: false, pendente: false });
    expect(e.conferemExcetoPendentes).toBe(false);
  });

  it('incorporação sem registro canônico e marcada como pendente → PENDENTE', async () => {
    const e = await runP(mundo({ registroIncorporacao: async () => null }), ['INCORPORACAO']);
    expect(passo(e, 'INCORPORACAO')).toMatchObject({ pendente: true });
    expect(e.conferemExcetoPendentes).toBe(true);
  });

  it('sem a lista de pendentes, o comportamento é o anterior (falha)', async () => {
    const e = await run(mundo({ registroIncorporacao: async () => null }));
    expect(passo(e, 'INCORPORACAO')).toMatchObject({ confere: false, pendente: false });
    expect(e.conferemExcetoPendentes).toBe(false);
  });
});

describe('E1-p: registro no formato do evento COTA_INCORPORADA (a5c1258)', () => {
  const novo = (over: Record<string, unknown> = {}) => {
    const r = {
      tipo: 'COTA_INCORPORADA', versao: 1, cotaId: 'c1', cessaoId: 'cessao1', hashLaudo: H_LAUDO,
      sha256PdfCessao: null, comprovantePixSha256: null, comprovantePixAncoraTxHash: null,
      valorIncorporadoBrl: '100.00', tokensEmitir: '10.0000000', navPorTokenUsado: '1.00000000', issuer: ISSUER, asset: 'PLINARF',
      ...over,
    };
    return regBytes(Buffer.from(JSON.stringify(r)));
  };
  it('confere com os nomes novos (valorIncorporadoBrl, tokensEmitir, navPorTokenUsado)', async () => {
    const e = await run(mundo({ registroIncorporacao: async () => novo() }));
    expect(passo(e, 'INCORPORACAO')).toMatchObject({ confere: true });
  });
  it('hashLaudo do registro ≠ laudo da cota reprova', async () => {
    const e = await run(mundo({ registroIncorporacao: async () => novo({ hashLaudo: 'f'.repeat(64) }) }));
    expect(passo(e, 'INCORPORACAO').motivo).toMatch(/hashLaudo/);
  });
  it('tokensEmitir ≠ tokens emitidos reprova', async () => {
    const e = await run(mundo({ registroIncorporacao: async () => novo({ tokensEmitir: '11.0000000' }) }));
    expect(passo(e, 'INCORPORACAO').motivo).toMatch(/quantidade/);
  });
});
