import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runbook = readFileSync('ops/runbooks/smoke-ciclo.md', 'utf8');
const script = readFileSync('scripts/smoke-ciclo.ts', 'utf8');
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** As pernas do script, na ordem: `titulo(n, TOTAL, 'ORIGINAR — …')` → "originar". */
const pernasDoScript = [...script.matchAll(/titulo\(\d+, TOTAL, '([A-ZÇÃÕ]+)/g)].map((m) => norm(m[1]!));
/** As pernas da tabela do runbook, na ordem: `| 5 | Resgatar | …`. */
const pernasDoRunbook = [...runbook.matchAll(/^\| (\d) \| ([^|]+?) \|/gm)].map((m) => norm(m[2]!.trim()));

describe('runbook do smoke:ciclo × o script (L7: o texto que o avaliador lê não pode se afastar do código)', () => {
  it('as pernas do runbook são as do script, na mesma ordem', () => {
    expect(pernasDoScript.length).toBeGreaterThanOrEqual(7);
    // o script diz "recuperar" onde o runbook diz "recuperar"; "resgatar", "realizar", "reconciliar" idem
    expect(pernasDoRunbook).toEqual(pernasDoScript);
  });

  it('o passo 5 descreve o resgate E2-6: 1 transação, 2 pagamentos, queima no issuer e TESOURO do distributor', () => {
    const linha = runbook.split('\n').find((l) => /^\| 5 \|/.test(l))!;
    expect(linha).toMatch(/E2-6/);
    expect(linha).toMatch(/1 transação com 2 pagamentos/);
    expect(linha).toMatch(/queima/i);
    expect(linha).toMatch(/TESOURO/);
    expect(linha).toMatch(/issuer/);
    expect(linha).toMatch(/distributor/);
  });

  it('não sobrou a descrição antiga do resgate (devolver PLINARF ao distributor, auditoria própria)', () => {
    expect(runbook).not.toMatch(/devolve metade|ao distributor \(BRL|auditoria ancorada|1 auditoria/);
  });

  it('o script de fato faz o resgate E2-6 (cotarResgate + submeterResgate) e não a liquidação antiga', () => {
    expect(script).toMatch(/cotarResgate/);
    expect(script).toMatch(/submeterResgate/);
    expect(script).not.toMatch(/buildLiquidarPlinarfXdr|submitLiquidacao/);
  });

  it('declara o que é simulado: DocuSign, Pix, TESOURO e Blob', () => {
    for (const t of [/DocuSign\*\* simulado/, /\*\*Pix\*\* SIMULADO/, /\*\*TESOURO\*\* é um ativo descartável/, /Vercel Blob\*\* é trocado/]) {
      expect(runbook).toMatch(t);
    }
  });

  it('o passo 7 desconta o que o resgate queimou (o script também)', () => {
    expect(runbook).toMatch(/− o que o resgate queimou/);
    expect(script).toMatch(/\.minus\(quantia\)/);
  });
});
