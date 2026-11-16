// @vitest-environment jsdom
/**
 * Auditoria de regras de input (16/11, achado da Flora): "Valor recebido" do Caminho A (/admin, comprador) tinha min=1 step=100.
 * O passo do HTML conta a partir do mínimo, então só 1, 101, 201… eram válidos e o valor sugerido pela própria tela
 * (ex.: 120000) já nascia inválido: o navegador impedia "Executar Caminho A". O servidor aceita qualquer decimal > 0
 * (app/api/admin/realizacao/route.ts regex numérico; lib/services/realizacao.ts: > 0). O HTML só pode ser tão solto quanto isso.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function campo(): HTMLInputElement {
  const src = readFileSync('app/admin/comprador-pipeline.tsx', 'utf8');
  const bloco = /<input[^>]*?name="valorRealizado"[\s\S]*?\/>/.exec(src)?.[0];
  if (!bloco) throw new Error('campo valorRealizado não encontrado em app/admin/comprador-pipeline.tsx');
  const attr = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(bloco)?.[1];
  const el = document.createElement('input');
  el.type = attr('type') ?? 'text';
  for (const n of ['min', 'max', 'step']) {
    const v = attr(n);
    if (v !== undefined) el.setAttribute(n, v);
  }
  return el;
}

describe('/admin — "Valor recebido" (Caminho A) aceita tudo que o servidor aceita (> 0)', () => {
  it.each(['0.01', '1', '50', '101', '150', '1234.5', '1234.56', '120000', '120000.00', '9999999.99'])(
    'valor %s passa na validação do navegador',
    (v) => {
      const el = campo();
      el.value = v;
      expect(el.checkValidity(), `valor ${v}`).toBe(true);
    },
  );

  it.each(['0', '-1', '-100'])('valor %s continua inválido (o servidor exige > 0)', (v) => {
    const el = campo();
    el.value = v;
    expect(el.checkValidity(), `valor ${v}`).toBe(false);
  });
});
