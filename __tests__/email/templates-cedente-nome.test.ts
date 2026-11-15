import { describe, expect, it } from 'vitest';
import { renderCedenteEmail } from '@/lib/email/templates-cedente';

describe('e-mails do cedente: o e-mail nunca é o nome (pós-cota 15/11)', () => {
  const kinds = ['oferta', 'cessao', 'pix', 'concluido'] as const;

  it.each(kinds)('%s: nome que é e-mail, vazio, ausente ou o marcador → saudação neutra "Olá." e o e-mail não aparece', (kind) => {
    for (const nome of ['test-4872@privy.io', '', null, undefined, 'Nome não informado']) {
      const r = renderCedenteEmail(kind, { leadId: 'l1', nome });
      expect(r.text.split('\n')[0]).toBe('Olá.');
      expect(r.html).toContain('Olá.');
      expect(`${r.text}${r.html}`).not.toMatch(/privy\.io/);
    }
  });

  it.each(kinds)('%s: nome de verdade segue saudado pelo nome', (kind) => {
    const r = renderCedenteEmail(kind, { leadId: 'l1', nome: 'Ana Souza' });
    expect(r.text.split('\n')[0]).toBe('Olá, Ana Souza.');
  });

  it("'concluido' com a tx de emissão traz o link como 'Prova on-chain' (igual ao e-mail da cessão); sem tx não traz", () => {
    const hash = 'a'.repeat(64);
    const com = renderCedenteEmail('concluido', { leadId: 'l1', nome: 'Ana', onChainTxHash: hash });
    expect(com.text).toMatch(new RegExp(`Prova on-chain: https?://\\S*${hash}`));
    expect(com.html).toContain(hash);
    expect(renderCedenteEmail('concluido', { leadId: 'l1', nome: 'Ana' }).text).not.toContain('Prova on-chain');
  });
});
