// @vitest-environment jsdom
/**
 * Auditoria de regras de input (16/11): o campo "Valor da carta" do /vender tinha min=1000 e step=1000, mais rígido que o
 * servidor (`/api/vender/simular`: numérico e > 0). A tela recusava R$ 500 e R$ 1.234. O HTML não é a regra de negócio:
 * aqui ele só pode ser tão solto quanto o servidor. Lê o atributo do próprio arquivo da tela (o componente interno da
 * página não é exportável) e valida os valores de fronteira no navegador (jsdom).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function campoValorDaCarta(): HTMLInputElement {
  const src = readFileSync('app/vender/page.tsx', 'utf8');
  const bloco = /<Field label="Valor da carta">([\s\S]*?)<\/Field>/.exec(src)?.[1];
  if (!bloco) throw new Error('campo "Valor da carta" não encontrado em app/vender/page.tsx');
  const attr = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(bloco)?.[1];
  const el = document.createElement('input');
  el.type = attr('type') ?? 'text';
  for (const n of ['min', 'max', 'step']) {
    const v = attr(n);
    if (v !== undefined) el.setAttribute(n, v);
  }
  return el;
}

describe('/vender — "Valor da carta" aceita tudo que o servidor aceita (> 0)', () => {
  it('não usa mais min=1000/step=1000', () => {
    const el = campoValorDaCarta();
    expect(el.getAttribute('step')).not.toBe('1000');
    expect(el.getAttribute('min')).not.toBe('1000');
  });

  it.each(['0.01', '1', '8', '500', '999', '1234', '1234.56', '1000', '150000', '9999999'])(
    'valor %s passa na validação do navegador',
    (v) => {
      const el = campoValorDaCarta();
      el.value = v;
      expect(el.checkValidity(), `valor ${v}`).toBe(true);
    },
  );

  it.each(['0', '-1', '-500'])('valor %s continua inválido (o servidor exige > 0)', (v) => {
    const el = campoValorDaCarta();
    el.value = v;
    expect(el.checkValidity(), `valor ${v}`).toBe(false);
  });
});
