import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/hooks/privy', () => ({ useAppPrivy: () => ({ getAccessToken: async () => null }) }));

import AcompanharView, { type AcompanharData } from '@/components/vender/AcompanharView';

const data: AcompanharData = {
  leadId: 'l1', cedenteNome: 'Cedente Teste', status: 'CONTATADO', etapaAtual: 2, contextoDescricao: 'x', ofertaId: null, oferta: null,
  cessaoId: null, consentTx: { hashShort: 'abcd1234', url: 'https://stellar.expert/explorer/testnet/tx/abcd1234' }, cessaoTx: null, pixTx: null, temCota: false,
};

describe('PainelValidacao (hotfix de texto falso, Consuelo 15/11)', () => {
  const html = renderToStaticMarkup(<AcompanharView data={data} />);

  it('mostra só o texto único da etapa', () => {
    expect(html).toContain('Nossa mesa está conferindo a titularidade e a situação da sua cota junto à administradora.');
    expect(html).toContain('data-testid="texto-validacao"');
  });

  it('não promete integração B2B/API, SLA, cartório com e-CPF nem taxa de anuência 1–3%', () => {
    expect(html).not.toMatch(/Integração B2B|via API|SLA|Cartório digital|e-CPF|1–3%|Taxa de anuência|Duas camadas|caminho preferencial|Fallback/i);
  });

  it('mantém a prova do consentimento (link do consentTx)', () => {
    expect(html).toContain('Hash do consentimento registrado on-chain na Stellar');
    expect(html).toContain('https://stellar.expert/explorer/testnet/tx/abcd1234');
  });
});

describe('mensagem do cadastro do investidor (register/route.ts)', () => {
  it('não manda "refazer o onboarding": diz para completar o cadastro', () => {
    const src = readFileSync('app/api/investidor/bank-account/register/route.ts', 'utf8');
    expect(src).toContain('Complete o seu cadastro antes de continuar.');
    expect(src).not.toMatch(/refaça o onboarding/);
  });
});
