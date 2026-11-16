import { describe, expect, it, vi } from 'vitest';

const rede = vi.hoisted(() => ({ atual: 'TESTNET' }));
vi.mock('@/lib/stellar/config', async (orig) => {
  const mod = { ...(await orig<typeof import('@/lib/stellar/config')>()) } as Record<string, unknown>;
  Object.defineProperty(mod, 'STELLAR_NETWORK', { get: () => rede.atual, enumerable: true });
  return mod;
});
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

describe('rodapé com aviso de fase de testes (A-06)', () => {
  const kinds = ['oferta', 'cessao', 'pix', 'concluido'] as const;

  it.each(kinds)('%s: fora da mainnet o texto e o html levam o aviso de demonstração', (kind) => {
    rede.atual = 'TESTNET';
    const r = renderCedenteEmail(kind, { leadId: 'l1', nome: 'Ana' });
    expect(r.text).toContain('Mensagem de demonstração (projeto em fase de testes, rede de testes): sem efeito jurídico nem financeiro.');
    expect(r.html).toContain('projeto em fase de testes');
    expect(r.text.trim().endsWith('sem efeito jurídico nem financeiro.')).toBe(true);
  });

  it.each(kinds)('%s: na mainnet NÃO leva o aviso', (kind) => {
    rede.atual = 'PUBLIC';
    const r = renderCedenteEmail(kind, { leadId: 'l1', nome: 'Ana' });
    expect(`${r.text}${r.html}`).not.toMatch(/fase de testes|demonstração/);
    rede.atual = 'TESTNET';
  });
});

describe('e-mails do cedente: texto aprovado (Norma/Consuelo; P0 de compliance)', () => {
  const kinds = ['oferta', 'cessao', 'pix', 'concluido'] as const;

  it('"concluído" por rede: TESTNET diz "pool de demonstração"; MAINNET diz "pool da Plina" SEM "demonstração" (texto da Norma); ambas "vender sua cota"', () => {
    rede.atual = 'TESTNET';
    const t = renderCedenteEmail('concluido', { leadId: 'l1', nome: 'Ana' });
    expect(t.text).toContain('Sua cota foi incorporada ao pool de demonstração da Plina. Obrigado por vender sua cota com a Plina.');
    expect(t.html).toContain('pool de demonstração da Plina');
    rede.atual = 'PUBLIC';
    const p = renderCedenteEmail('concluido', { leadId: 'l1', nome: 'Ana' });
    expect(p.text).toContain('Sua cota foi incorporada ao pool da Plina. Obrigado por vender sua cota com a Plina.');
    expect(`${p.subject}${p.text}${p.html}`).not.toMatch(/demonstra/i);
    rede.atual = 'TESTNET';
  });

  it.each(kinds)('%s: "pool público" / "pool tokenizado público" e "negociar" NÃO voltam (texto e HTML, testnet e mainnet); "prova pública" do hash on-chain é correto e fica', (kind) => {
    for (const modo of ['TESTNET', 'PUBLIC'] as const) {
      rede.atual = modo;
      const r = renderCedenteEmail(kind, { leadId: 'l1', nome: 'Ana' });
      expect(`${r.subject}\n${r.text}\n${r.html}`, `${kind}/${modo}`).not.toMatch(/pool\s+(tokenizado\s+)?p[úu]blico|negociar/i);
    }
    rede.atual = 'TESTNET';
  });
});
