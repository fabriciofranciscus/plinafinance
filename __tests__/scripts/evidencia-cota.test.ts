import { describe, expect, it } from 'vitest';
import { memoHashDaIncorporacao } from '@/lib/services/tokenizacao';
import { sha256OfPayload } from '@/lib/stellar/audit';
import { memoDaIncorporacao, montarEvidencia, paraMarkdown, sha256Hex, type Fontes } from '../../scripts/evidencia-cota/core';

const TX = (n: string) => n.repeat(64).slice(0, 64);
const PDF = Buffer.from('%PDF-1.7 cessao assinada');
const COMP = Buffer.from('%PDF-1.7 comprovante psp');
const LAUDO = { parecer: 'ok', cota: 'c1' };
const H_LAUDO = sha256OfPayload(LAUDO);
const MEMO_EMISSAO = memoDaIncorporacao('cessao1');

/** Mundo feliz; cada teste sobrescreve UMA coisa. */
function mundo(over: Partial<Fontes> = {}, memos: Record<string, string | null> = {}): Fontes {
  const m: Record<string, string | null> = {
    [TX('a')]: H_LAUDO, [TX('b')]: sha256Hex(PDF), [TX('c')]: sha256Hex(COMP), [TX('d')]: MEMO_EMISSAO, ...memos,
  };
  return {
    hashPayload: sha256OfPayload,
    cota: async () => ({ id: 'c1', cessaoId: 'cessao1', hashValidacao: H_LAUDO, validacaoTxHash: TX('a'), emissaoTxHash: TX('d'), tokensEmitidos: '10' }),
    laudo: async () => ({ payloadJson: LAUDO, payloadHash: H_LAUDO }),
    cessao: async () => ({ status: 'ASSINADA', hashDocumento: sha256Hex(PDF), onChainTxHash: TX('b') }),
    pdfCessao: async () => PDF,
    pagamento: async () => ({ status: 'EXECUTADO', onChainTxHash: TX('c') }),
    comprovante: async () => COMP,
    aporte: async () => ({ txHash: TX('d'), hashValidacao: H_LAUDO, valorBrl: '100.00', navPorToken: '1.00000000' }),
    tx: async (h) => (h in m ? { sucesso: true, memoHex: m[h] } : null),
    ...over,
  };
}
const run = (f: Fontes) => montarEvidencia('c1', f, () => new Date('2026-11-14T12:00:00Z'));
const passo = (e: Awaited<ReturnType<typeof run>>, id: string) => e.passos.find((p) => p.passo === id)!;

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
    ['aporte em outra tx', { aporte: async () => ({ txHash: TX('e'), hashValidacao: H_LAUDO, valorBrl: '1', navPorToken: '1' }) }, 'INCORPORACAO', /FORA_DA_TX/],
    ['aporte sem o laudo', { aporte: async () => ({ txHash: TX('d'), hashValidacao: sha256Hex('x'), valorBrl: '1', navPorToken: '1' }) }, 'INCORPORACAO', /SEM_O_LAUDO/],
  ];
  it.each(casos)('reprova: %s', async (_n, over, id, motivo) => {
    const e = await run(mundo(over));
    expect(passo(e, id).confere).toBe(false);
    expect(passo(e, id).motivo).toMatch(motivo);
    expect(e.todosConferem).toBe(false);
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
      cota: async () => ({ id: 'c1', cessaoId: null, hashValidacao: H_LAUDO, validacaoTxHash: TX('a'), emissaoTxHash: TX('d'), tokensEmitidos: '1' }),
    }, { [TX('d')]: memoDaIncorporacao(H_LAUDO) });
    expect(passo(await run(semCessao), 'EMISSAO').confere).toBe(true);
  });
});
