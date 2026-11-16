import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderCedenteEmail } from '@/lib/email/templates-cedente';
import { humanizeError } from '@/app/investir/_lib/errors';
import { SACAR } from '@/lib/sacar/microcopy';

// U3 (Consuelo, validado pela Norma em 16/11): 3 textos ALTO, sem prazo prometido e sem palavra proibida.
describe('U3 ALTO 1: /sacar não promete prazo nem usa jargão interno', () => {
  const src = readFileSync('app/sacar/page.tsx', 'utf8');
  it('a página não contém "nos próximos minutos", "Sandbox PIX/BRL não settla", "constraint upstream" nem "Burn confirmado"', () => {
    expect(src).not.toMatch(/nos próximos minutos|Sandbox PIX\/BRL não settla|constraint upstream|Burn confirmado/);
  });
  it('o estado concluído usa o texto do gate da Norma (16/11), vindo do microcopy', () => {
    expect(src).toContain('SACAR.aguardando.textoPagamento');
    expect(SACAR.aguardando.textoPagamento).toBe(
      'Estamos aguardando a confirmação do pagamento. Esta página se atualiza sozinha. Em rede de testes, o Pix é simulado e não chega a nenhuma conta.',
    );
  });
  it('o microcopy de espera não indica prazo ("Pode levar alguns instantes" saiu)', () => {
    expect(SACAR.aguardando.texto).toBe('Estamos aguardando a confirmação. Esta página se atualiza sozinha.');
    expect(JSON.stringify(SACAR.aguardando)).not.toMatch(/Pode levar|instantes/);
  });
});

describe('U3 ALTO 2: erro de limite da anchor sem "institucional" nem "tíquete"', () => {
  const r = humanizeError('Etherfuse: limit exceeded');
  it('texto aprovado', () => {
    expect(r.message).toBe('Limite de teste atingido. Tente de novo mais tarde ou fale com a equipe em contato@plina.finance.');
  });
  it('sem palavra proibida', () => {
    expect(r.message).not.toMatch(/institucional|tíquete|compromisso/i);
  });
});

describe('U3 ALTO 3: e-mail da cessão sem prazo', () => {
  const r = renderCedenteEmail('cessao', { leadId: 'l' });
  it('texto aprovado, no html e no texto simples', () => {
    const t = 'Sua cessão foi registrada na rede de testes. O pagamento segue as próximas etapas; avisaremos por e-mail nos principais avanços.';
    expect(r.text).toContain(t);
    expect(r.html).toContain(t);
  });
  it('não diz "em seguida" nem promete execução do Pix', () => {
    expect(`${r.html}${r.text}`).not.toMatch(/em seguida|será executado/);
  });
});
