import type { Screen } from '../_types';

export const SCREENS: { id: Screen; label: string }[] = [
  { id: 'welcome', label: 'Acesso' },
  { id: 'identity', label: 'Identidade' },
  { id: 'banking', label: 'Conta PIX' },
  { id: 'quote', label: 'Cotação' },
  { id: 'onramp', label: 'Pagamento' },
  { id: 'settling', label: 'Liquidação' },
  { id: 'claiming', label: 'Resgate' },
  { id: 'confirm', label: 'Revisão' },
  { id: 'receipt', label: 'Confirmação' },
];

export const QUOTE_PRESETS = ['100', '250', '430'];
export const QUOTE_TTL_MS = 60_000;

export const GLOSSARY: Record<string, string> = {
  trustline:
    'Autorização do investidor pra receber um asset emitido por outra conta Stellar. Sem trustline, a wallet não aceita o token.',
  authorize:
    'Operação do issuer que libera a trustline pra movimentação. PLINA-RF tem AUTH_REQUIRED, exigindo authorize explícito.',
  distribute:
    'Pagamento do distributor pra wallet do investidor. Após authorize, o issuer libera; o distributor paga.',
  TESOURO:
    'Token Stellar emitido pela Etherfuse representando Tesouro Direto brasileiro. Bridge intermediário entre BRL e PLINA-RF no fluxo de produção.',
  'paridade NAV':
    'Razão 1:1 entre PLINA-RF e o valor patrimonial líquido (NAV) do FIDC. No POC, mantida sem revalorização; em produção, NAV é apurado diariamente.',
  clawback:
    'AUTH_CLAWBACK_ENABLED. Permite o issuer revogar tokens em hipóteses limitadas (judicial, sanção, fraude, erro). Diferencial institucional documentado no whitepaper §6.5.',
  'swap atômico':
    'Envelope Stellar com 2 operações no mesmo tx: investor paga TESOURO ao distributor + distributor paga PLINA-RF ao investor. Ambas legs commitam juntas — sem TESOURO, sem PLINA-RF. Substitui o single-shot do MVP por settlement on-chain real.',
  onramp:
    'BRL → TESOURO via Etherfuse. Investidor paga PIX off-chain, Etherfuse paga TESOURO na wallet Stellar. Pré-condição pro swap PLINA-RF.',
};
