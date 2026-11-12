import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { canonicalizar } from '@/lib/services/json-canonico';
import { montarNumerador, recalcularNav, type ArquivoSnapshotNav } from '@/lib/services/snapshot-nav-arquivo';
import { desdeDaAncora, verificarSnapshot, type LeitorHorizon, type TxHorizon } from '@/lib/services/snapshot-nav-verificar';

const D = (v: string) => new Prisma.Decimal(v);
const DIST = 'GDIST';

const COTA1 = { id: 'c1', status: 'DISPONIVEL', valorCarta: '100000.00', desagioAquisicao: '0.2000', hashValidacao: 'h'.repeat(64), emissaoTxHash: 'e'.repeat(64) };

function arquivoBase(cotas: Array<typeof COTA1> = [COTA1]): ArquivoSnapshotNav {
  const numerador = montarNumerador(
    cotas,
    { movimentos: 1, porTipo: { SUBSCRICAO: '2000' } },
  );
  const base = {
    numerador,
    circulante: {
      PLINARF: {
        issuer: 'GISS', distributor: DIST, totalEmitido: '82000.0000000', saldoIssuer: '0.0000000',
        saldoDistributor: '0.0000000', circulante: '82000.0000000',
        trustlinesAutorizadas: { contas: 3, soma: '82000.0000000' },
      },
    },
    nav: { classe: 'PLINARF', regra: 'NAV_DO_LEDGER' as const, denominador: '', porToken: '', porTokenSobreCirculante: null, notaDenominador: '' },
  };
  const r = recalcularNav(base);
  return {
    tipo: 'plina.nav-snapshot', versao: 1, data: '2026-11-12', geradoEm: '2026-11-12T09:00:00.000Z', rede: 'TESTNET',
    horizon: { ledger: 100, fechadoEm: '2026-11-12T08:59:55Z', lidoEm: '2026-11-12T08:59:59.000Z', ledgerFinal: 101 },
    ...base,
    conciliacao: { PLINARF: { confere: true, diferenca: '0.0000000' } },
    nav: {
      classe: 'PLINARF', regra: r.regra, denominador: r.denominador.toFixed(7), porToken: r.porToken.toFixed(8),
      porTokenSobreCirculante: r.porTokenSobreCirculante!.toFixed(8), notaDenominador: 'n',
    },
  };
}
const bytesDe = (a: unknown) => Buffer.from(canonicalizar(a), 'utf8');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function leitor(over: Partial<{ ledger: number; emitido: string; dist: string; soma: string; contas: number; txs: (memo: string) => TxHorizon[]; tx: (hash: string) => TxHorizon | null; tesouro: string }> = {}): LeitorHorizon {
  const o = { ledger: 101, emitido: '82000', dist: '0', soma: '82000', contas: 3, ...over };
  return {
    transacao: async (hash) =>
      (over.tx ?? ((h) => ({ hash: h, successful: true, source_account: 'GISS', memo_type: 'hash', memo: 'AAAA', created_at: '2026-11-10T10:00:00Z' })))(hash),
    ledgerAtual: async () => ({ ledger: o.ledger, fechadoEm: '2026-11-12T09:01:00Z' }),
    totalEmitido: async () => D(o.emitido),
    saldoDaConta: async (_c, code) => (code === 'TESOURO' ? D(over.tesouro ?? '0') : D(o.dist)),
    trustlinesAutorizadas: async () => ({ soma: D(o.soma), contas: o.contas }),
    buscarPorMemo: async (_c, memo) =>
      (o.txs ?? ((m) => [{ hash: 'tx1', successful: true, source_account: DIST, memo_type: 'hash', memo: m, created_at: '2026-11-12T09:00:06Z' }]))(memo),
  };
}
const PLINA = { issuerEsperado: 'GISS', distributorEsperado: DIST, redeEsperada: 'testnet' };
const estado = (r: Awaited<ReturnType<typeof verificarSnapshot>>, id: string) => r.conferencias.find((c) => c.id === id)?.estado;

describe('verificarSnapshot (a prova do avaliador)', () => {
  it('arquivo honesto, âncora com memo = SHA-256, Horizon igual: tudo ✓, saída 0', async () => {
    const bytes = bytesDe(arquivoBase());
    const r = await verificarSnapshot(bytes, leitor(), PLINA);
    expect(r.codigoSaida).toBe(0);
    expect(r.sha256).toBe(sha(bytes));
    expect(r.conferencias.every((c) => c.estado === 'ok')).toBe(true);
  });

  it('F-E31-2: sem fixar issuer/distributor da Plina o resultado NUNCA é "conferido" (saída 2) e imprime as contas do arquivo', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor());
    expect(r.codigoSaida).toBe(2);
    expect(estado(r, 'contas-da-plina-fixadas')).toBe('nao_conferido');
    expect(r.conferencias.find((c) => c.id === 'contas-da-plina-fixadas')?.detalhe).toMatch(/GISS.*GDIST/);
  });

  it('F-E31-2: arquivo forjado com contas de outra parte é reprovado quando as da Plina são fixadas', async () => {
    const a = arquivoBase();
    a.circulante.PLINARF.issuer = 'GATACANTE_ISSUER';
    a.circulante.PLINARF.distributor = 'GATACANTE_DIST';
    const r = await verificarSnapshot(bytesDe(a), leitor({ txs: (m) => [{ hash: 'tx1', successful: true, source_account: 'GATACANTE_DIST', memo_type: 'hash', memo: m, created_at: 'x' }] }), PLINA);
    expect(estado(r, 'contas-da-plina')).toBe('falhou');
    expect(r.codigoSaida).toBe(1);
  });

  it('memo da âncora ≠ SHA-256 do arquivo (arquivo trocado depois de ancorar): falha', async () => {
    const original = bytesDe(arquivoBase());
    const adulterado = bytesDe({ ...arquivoBase(), data: '2026-11-13' });
    const memoDoOriginal = Buffer.from(sha(original), 'hex').toString('base64');
    const r = await verificarSnapshot(adulterado, leitor({ txs: (m) => (m === memoDoOriginal ? [] : []) }));
    expect(estado(r, 'ancora')).toBe('falhou');
    expect(r.codigoSaida).toBe(1);
  });

  it('âncora de outra conta (fonte diferente do distributor) não vale', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor({
      txs: (m) => [{ hash: 'tx9', successful: true, source_account: 'GOUTRO', memo_type: 'hash', memo: m, created_at: 'x' }],
    }));
    expect(estado(r, 'ancora')).toBe('falhou');
  });

  it('tx falhada com o memo certo não vale', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor({
      txs: (m) => [{ hash: 'tx9', successful: false, source_account: DIST, memo_type: 'hash', memo: m, created_at: 'x' }],
    }));
    expect(estado(r, 'ancora')).toBe('falhou');
  });

  it('--tx diferente da âncora achada: falha', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor(), { txHash: 'outra' });
    expect(estado(r, 'ancora')).toBe('falhou');
  });

  it('arquivo não canônico (espaço a mais, mesmas chaves): recusa — o hash seria de outros bytes', async () => {
    const r = await verificarSnapshot(Buffer.from(JSON.stringify(arquivoBase(), null, 1), 'utf8'), leitor());
    expect(estado(r, 'arquivo')).toBe('falhou');
    expect(r.codigoSaida).toBe(1);
  });

  it('NAV do arquivo que não sai da própria conta (porToken editado): falha', async () => {
    const a = arquivoBase();
    a.nav.porToken = '9.99999999';
    const r = await verificarSnapshot(bytesDe(a), leitor());
    expect(estado(r, 'nav-do-arquivo')).toBe('falhou');
  });

  it('Horizon diverge no MESMO ledger do arquivo: falha (não é desculpa de tempo)', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor({ ledger: 101, emitido: '90000', soma: '90000' }));
    expect(estado(r, 'horizon-PLINARF')).toBe('falhou');
    expect(r.codigoSaida).toBe(1);
  });

  it('saldos mudaram depois do ledger do arquivo: "não conferido" (saída 2), sem reprovar nem fingir ✓', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor({ ledger: 5000, emitido: '90000', soma: '90000' }));
    expect(estado(r, 'horizon-PLINARF')).toBe('nao_conferido');
    expect(estado(r, 'ancora')).toBe('ok');
    expect(estado(r, 'nav-do-arquivo')).toBe('ok');
    expect(r.codigoSaida).toBe(2);
  });

  it('conciliação do próprio arquivo quebrada (Σ trustlines ≠ circulante): falha', async () => {
    const a = arquivoBase();
    a.circulante.PLINARF.trustlinesAutorizadas.soma = '81000.0000000';
    const r = await verificarSnapshot(bytesDe(a), leitor({ soma: '81000' }));
    expect(estado(r, 'conciliacao-PLINARF')).toBe('falhou');
  });

  it('NAV_INICIAL com ativo > 0 no arquivo (R$ 1,00 dando o pool ao 1º investidor): falha', async () => {
    const a = arquivoBase();
    a.circulante.PLINARF = { ...a.circulante.PLINARF, totalEmitido: '0.0000000', circulante: '0.0000000', trustlinesAutorizadas: { contas: 0, soma: '0.0000000' } };
    a.nav = { ...a.nav, regra: 'NAV_INICIAL', denominador: '0.0000000', porToken: '1.00000000', porTokenSobreCirculante: null };
    const r = await verificarSnapshot(bytesDe(a), leitor({ emitido: '0', soma: '0', contas: 0 }));
    expect(estado(r, 'nav-do-arquivo')).toBe('falhou');
  });

  it('rede do arquivo ≠ rede informada: falha', async () => {
    const r = await verificarSnapshot(bytesDe({ ...arquivoBase(), rede: 'PUBLIC' }), leitor(), PLINA);
    expect(estado(r, 'rede')).toBe('falhou');
    expect(r.codigoSaida).toBe(1);
  });

  it('âncora de outra conta que não o distributor INFORMADO (o arquivo declara a conta do atacante e ela ancorou): falha', async () => {
    const a = arquivoBase();
    a.circulante.PLINARF.distributor = 'GATACANTE_DIST';
    const r = await verificarSnapshot(
      bytesDe(a),
      leitor({ txs: (m) => [{ hash: 'tx1', successful: true, source_account: 'GATACANTE_DIST', memo_type: 'hash', memo: m, created_at: 'x' }] }),
      PLINA,
    );
    expect(estado(r, 'ancora')).toBe('falhou'); // busca/exige source = distributor informado
    expect(estado(r, 'contas-da-plina')).toBe('falhou');
    expect(r.codigoSaida).toBe(1);
  });

  it('F-E31-3: a saída diz que denominador e conciliação vêm do Horizon e o numerador são insumos publicados com hash ancorado', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor(), PLINA);
    expect(r.conferencias.find((c) => c.id === 'numerador')?.detalhe).toMatch(
      /denominador e conciliação refeitos do Horizon; numerador = insumos publicados.*hash de validação ancorado/,
    );
  });

  it('S3: a busca da âncora é limitada pela data do arquivo (menos 1 h de folga), não pelo histórico todo', async () => {
    let recebido: string | undefined;
    const l = leitor();
    const orig = l.buscarPorMemo;
    l.buscarPorMemo = async (c, m, desde) => { recebido = desde; return orig(c, m, desde); };
    await verificarSnapshot(bytesDe(arquivoBase()), l, PLINA);
    expect(recebido).toBe('2026-11-12T08:00:00.000Z'); // geradoEm 09:00Z − 1 h
    expect(desdeDaAncora('lixo')).toBe('1970-01-01T00:00:00.000Z');
  });

  it('S4: distributor em ACCOUNTS do stellar.toml da Plina → ok; ausente ou toml sem ACCOUNTS → não conferido (saída 2)', async () => {
    const bytes = bytesDe(arquivoBase());
    const ok = await verificarSnapshot(bytes, leitor(), { ...PLINA, toml: { dominio: 'plina.finance', accounts: [DIST] } });
    expect(estado(ok, 'distributor-no-toml')).toBe('ok');
    expect(ok.codigoSaida).toBe(0);
    for (const accounts of [['GOUTRA'], null]) {
      const r = await verificarSnapshot(bytes, leitor(), { ...PLINA, toml: { dominio: 'plina.finance', accounts } });
      expect(estado(r, 'distributor-no-toml')).toBe('nao_conferido');
      expect(r.codigoSaida).toBe(2);
    }
  });

  it('S4: toml de outro domínio (--toml-domain trocado) não vale como âncora de confiança', async () => {
    const r = await verificarSnapshot(bytesDe(arquivoBase()), leitor(), { ...PLINA, toml: { dominio: 'atacante.example', accounts: [DIST] } });
    expect(estado(r, 'toml-dominio')).toBe('nao_conferido');
    expect(r.codigoSaida).toBe(2);
  });

  it.each([
    ['sem rede', (a: any) => { delete a.rede; }],
    ['sem circulante', (a: any) => { delete a.circulante; }],
    ['sem horizon', (a: any) => { delete a.horizon; }],
    ['sem numerador.caixaRealizado', (a: any) => { delete a.numerador.caixaRealizado; }],
    ['classe do NAV ausente em circulante', (a: any) => { a.nav.classe = 'OUTRA'; }],
    ['número malformado', (a: any) => { a.circulante.PLINARF.totalEmitido = 'abc'; }],
    ['NAV sem regra válida', (a: any) => { a.nav.regra = 'X'; }],
  ])('F-O2: arquivo canônico mas incompleto (%s) → falhou com relatório, sem lançar', async (_n, quebrar) => {
    const a = arquivoBase() as any;
    quebrar(a);
    const r = await verificarSnapshot(bytesDe(a), leitor(), PLINA);
    expect(r.conferencias.some((c) => c.id === 'arquivo' && c.estado === 'falhou')).toBe(true);
    expect(r.codigoSaida).toBe(1);
  });

  describe('cotas ativas ligadas à rede (emissaoTxHash) — Consuelo', () => {
    const bytes = () => bytesDe(arquivoBase());
    it('emissão bem-sucedida, do issuer, com Memo.hash → ok (e o arquivo honesto segue CONFERIDO)', async () => {
      const r = await verificarSnapshot(bytes(), leitor(), PLINA);
      expect(estado(r, 'cotas-emissao')).toBe('ok');
      expect(r.codigoSaida).toBe(0);
    });
    it.each([
      ['não encontrada', () => null],
      ['falhou na rede', (h: string) => ({ hash: h, successful: false, source_account: 'GISS', memo_type: 'hash', created_at: 'x' })],
    ])('emissão %s → falhou (saída 1)', async (_n, tx) => {
      const r = await verificarSnapshot(bytes(), leitor({ tx: tx as never }), PLINA);
      expect(estado(r, 'cotas-emissao')).toBe('falhou');
      expect(r.codigoSaida).toBe(1);
    });
    it('emissão confirmada, do issuer em vigor, SEM Memo.hash = LEGADO: listada à parte, com contagem e a regra citada, e NÃO derruba a prova (saída 0)', async () => {
      const r = await verificarSnapshot(bytes(), leitor({ tx: ((h: string) => ({ hash: h, successful: true, source_account: 'GISS', memo_type: 'none', created_at: 'x' })) as never }), PLINA);
      const legadas = r.conferencias.find((c) => c.id === 'cotas-legadas');
      expect(legadas?.estado).toBe('aviso');
      expect(legadas?.detalhe).toMatch(/^1 LEGADO: emissão confirmada, sem cadeia de hashes/);
      expect(legadas?.detalhe).toMatch(/Regra: LEGADO só quando a emissaoTxHash existe na rede, foi bem-sucedida, saiu do issuer em vigor e NÃO tem o Memo\.hash do modelo E1-4/);
      expect(legadas?.detalhe).toMatch(/Código 0 = nada reprovou e toda emissão do modelo E1-4 confere/);
      expect(estado(r, 'cotas-emissao')).toBe('ok');
      expect(r.codigoSaida).toBe(0);
    });
    it.each([
      ['de OUTRO issuer, com Memo.hash', (h: string) => ({ hash: h, successful: true, source_account: 'GOUTRA', memo_type: 'hash', created_at: 'x' })],
      ['de OUTRO issuer, sem memo (não é legada: reprova)', (h: string) => ({ hash: h, successful: true, source_account: 'GOUTRA', memo_type: 'none', created_at: 'x' })],
    ])('emissão confirmada mas %s → ✗ (saída ≠ 0), nunca LEGADO', async (_n, tx) => {
      const r = await verificarSnapshot(bytes(), leitor({ tx: tx as never }), PLINA);
      expect(estado(r, 'cotas-emissao')).toBe('falhou');
      expect(r.conferencias.find((c) => c.id === 'cotas-emissao')?.detalhe).toMatch(/outro issuer reprova/);
      expect(r.conferencias.some((c) => c.id === 'cotas-legadas')).toBe(false);
      expect(r.codigoSaida).toBe(1);
    });
    it('a classificação vem do FATO on-chain, não de rótulo do arquivo: item que se declara "E1-4" mas cuja tx não tem Memo.hash é LEGADO; item rotulado "legado" cuja tx tem Memo.hash do issuer é E1-4', async () => {
      const a = arquivoBase();
      Object.assign(a.numerador.cotasAtivas.itens[0], { modelo: 'E1-4', legado: false });
      const r1 = await verificarSnapshot(bytesDe(a), leitor({ tx: ((h: string) => ({ hash: h, successful: true, source_account: 'GISS', memo_type: 'none', created_at: 'x' })) as never }), PLINA);
      expect(r1.conferencias.some((c) => c.id === 'cotas-legadas')).toBe(true);
      const b = arquivoBase();
      Object.assign(b.numerador.cotasAtivas.itens[0], { modelo: 'LEGADO', legado: true });
      const r2 = await verificarSnapshot(bytesDe(b), leitor(), PLINA);
      expect(r2.conferencias.some((c) => c.id === 'cotas-legadas')).toBe(false);
      expect(estado(r2, 'cotas-emissao')).toBe('ok');
    });
    it('misto: 1 cota E1-4 + 3 legadas, arquivo consistente → saída 0, com as 3 listadas à parte', async () => {
      const a = arquivoBase([COTA1, ...[2, 3, 4].map((n) => ({ ...COTA1, id: `legada${n}`, emissaoTxHash: String(n).repeat(64) }))]);
      const r = await verificarSnapshot(
        bytesDe(a),
        leitor({
          tx: ((h: string) => (/^[234]+$/.test(h) ? { hash: h, successful: true, source_account: 'GISS', memo_type: 'none', created_at: 'x' } : { hash: h, successful: true, source_account: 'GISS', memo_type: 'hash', created_at: 'x' })) as never,
        }),
        PLINA,
      );
      expect(r.conferencias.find((c) => c.id === 'cotas-legadas')?.detalhe).toMatch(/^3 LEGADO: .*legada2, legada3, legada4/);
      expect(estado(r, 'cotas-emissao')).toBe('ok');
      expect(r.conferencias.filter((c) => c.estado === 'falhou' || c.estado === 'nao_conferido')).toEqual([]);
      expect(r.codigoSaida).toBe(0);
    });
    it('legada + uma emissão INEXISTENTE na rede → ✗ (saída 1): inexistente ou falhada continua reprovando e não é rebaixada a legada', async () => {
      const a = arquivoBase();
      const base = a.numerador.cotasAtivas.itens[0];
      a.numerador.cotasAtivas.itens = [base, { ...base, cotaId: 'fantasma', emissaoTxHash: 'f'.repeat(64) }];
      const r = await verificarSnapshot(bytesDe(a), leitor({ tx: ((h: string) => (h === 'f'.repeat(64) ? null : { hash: h, successful: true, source_account: 'GISS', memo_type: 'none', created_at: 'x' })) as never }), PLINA);
      expect(estado(r, 'cotas-emissao')).toBe('falhou');
      expect(r.conferencias.some((c) => c.id === 'cotas-legadas')).toBe(false);
      expect(r.codigoSaida).toBe(1);
    });
    it.each([
      ['curto', 'abc123'],
      ['maiúsculas', 'E'.repeat(64)],
      ['com caracteres de URL/path', '../accounts/GAAAA' + 'a'.repeat(47)],
      ['com espaço', ' ' + 'e'.repeat(63)],
      ['64 caracteres não hex', 'g'.repeat(64)],
      ['tipo errado (número)', 12345 as never],
    ])('F-E31-6: emissaoTxHash %s no arquivo (terceiros) → ✗ sem tocar o Horizon e sem repetir o conteúdo cru', async (_n, valor) => {
      const a = arquivoBase();
      a.numerador.cotasAtivas.itens[0].emissaoTxHash = valor as never;
      const chamadas: string[] = [];
      const r = await verificarSnapshot(bytesDe(a), leitor({ tx: ((h: string) => { chamadas.push(h); return null; }) as never }), PLINA);
      expect(estado(r, 'cotas-emissao')).toBe('falhou');
      expect(r.conferencias.find((c) => c.id === 'cotas-emissao')?.detalhe).toMatch(/emissaoTxHash inválido/);
      expect(r.conferencias.find((c) => c.id === 'cotas-emissao')?.detalhe).not.toContain(String(valor));
      expect(chamadas).toEqual([]); // nada vai à rede
      expect(r.codigoSaida).toBe(1);
    });
    it('cota sem emissaoTxHash no arquivo → não conferido (nunca ok em silêncio), saída 2', async () => {
      const a = arquivoBase();
      a.numerador.cotasAtivas.itens[0].emissaoTxHash = null;
      const r = await verificarSnapshot(bytesDe(a), leitor(), PLINA);
      expect(estado(r, 'cotas-emissao')).toBe('nao_conferido');
      expect(r.codigoSaida).toBe(2);
    });
  });

  describe('conferência PARCIAL do TESOURO — Consuelo', () => {
    const T = { code: 'TESOURO', issuer: 'GETHER', precoBrl: '1.167' };
    it('TESOURO × preço ≥ caixa realizado → ok, rotulado PARCIAL; não pedida → nenhuma linha', async () => {
      const b = bytesDe(arquivoBase()); // caixa 2000
      const ok = await verificarSnapshot(b, leitor({ tesouro: '2000' }), { ...PLINA, tesouro: T });
      expect(estado(ok, 'tesouro-cobre-caixa')).toBe('ok');
      expect(ok.conferencias.find((c) => c.id === 'tesouro-cobre-caixa')?.detalhe).toMatch(/PARCIAL/);
      expect((await verificarSnapshot(b, leitor(), PLINA)).conferencias.some((c) => c.id === 'tesouro-cobre-caixa')).toBe(false);
    });
    it('TESOURO insuficiente (no mesmo ledger ou depois) é só AVISO: nunca reprova nem muda o código de saída', async () => {
      const b = bytesDe(arquivoBase());
      for (const ledger of [101, 5000]) {
        const r = await verificarSnapshot(b, leitor({ tesouro: '100', ledger }), { ...PLINA, tesouro: T });
        expect(estado(r, 'tesouro-cobre-caixa')).toBe('aviso');
        expect(r.conferencias.find((c) => c.id === 'tesouro-cobre-caixa')?.detalhe).toMatch(/PARCIAL.*<.*caixa/);
      }
      // com ledger no mesmo ponto e tudo o mais conferido, o resultado continua CONFERIDO (saída 0)
      expect((await verificarSnapshot(b, leitor({ tesouro: '100', ledger: 101 }), { ...PLINA, tesouro: T })).codigoSaida).toBe(0);
    });
  });

  it('não é JSON: falha sem lançar', async () => {
    const r = await verificarSnapshot(Buffer.from('não é json'), leitor());
    expect(r.codigoSaida).toBe(1);
    expect(estado(r, 'arquivo')).toBe('falhou');
  });
});
