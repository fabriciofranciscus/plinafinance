export type Screen =
  | 'identity'
  | 'banking'
  | 'classe'
  | 'quote'
  | 'onramp'
  | 'settling'
  | 'claiming'
  | 'confirm'
  | 'receipt';

/** F-M3-4. Classe PLINA-RF escolhida pelo investidor. */
export type ClasseEscolhida = 'SENIOR' | 'SUBORDINADA';

// ─── Scaffolds institucionais (mockup "Para Investidores" do CEO) ───────────
// UI agora, integração depois. Mantidos client-only nesta fase; os campos de
// destino já existem no modelo Prisma `Investidor` (tipo, jurisdicao,
// razaoSocial, cnpj, enderecoEntidade) — ver TODO seams em identity/confirm.

/** Trilha do investidor: Brasil (retail funcional) ou Internacional (M4). */
export type InvestorTrack = 'BR' | 'INTL';

/** Provedor de custódia. SELF = wallet Privy embedded (único funcional hoje). */
export type CustodyProvider = 'FIREBLOCKS' | 'BITGO' | 'COPPER' | 'SELF';

/** Moeda de depósito. BRL/USDC reais via on-ramp; demais preparadas (M4). */
export type DepositCurrency = 'BRL' | 'USDC' | 'EURC' | 'USD' | 'EUR';

export type EntityType = 'FAMILY_OFFICE' | 'ASSET_MANAGER' | 'FUND' | 'OTHER';

/**
 * Perfil institucional coletado no onboarding (cartão 1 do mockup). Client-only
 * nesta fase — seam de persistência: estender `/api/investidor/suitability`
 * (que já grava `tipo`) para gravar nas colunas existentes do `Investidor`.
 */
export interface InstitutionalProfile {
  entityName: string;
  /** ISO 3166-1 alpha-2 ("BR", "US", "GB", "SG"). */
  jurisdiction: string;
  /** CNPJ (14 dígitos, com ou sem máscara). Só na trilha BR. */
  cnpj?: string;
  entityType: EntityType;
  currency: DepositCurrency;
}

export interface OnboardData {
  investidorId: string;
  publicKey: string;
  etherfuseCustomerId: string;
  kycStatus: 'approved' | 'pending' | 'not_started';
  fundedNow: boolean;
  /** Trustlines (TESOURO + PLINARF + PLINARFB) já existem on-chain. */
  trustlinesReady?: boolean;
}

export interface QuoteData {
  quoteId: string;
  fromAmount: string;
  /** Valor em TESOURO que o investidor paga na perna 1 do swap. */
  toAmount: string;
  /** Tokens a emitir pelo NAV (N1), calculado no servidor. Ausente em cotação antiga. */
  plinarfAmount?: string | null;
  /** NAV por token que o servidor usou na cotação (só informativo). */
  navPorTokenNaCotacao?: string | null;
  exchangeRate: string;
  fee: string;
  expiresAt: string;
}

export interface PixInstructions {
  type?: string;
  pixCode?: string;
  pixKey?: string;
  pixKeyType?: string;
  beneficiary?: string;
  amount?: string;
  currency?: string;
  __mock?: boolean;
}

export interface OnRampData {
  orderId: string;
  status: string;
  paymentInstructions: PixInstructions | null;
  mock: boolean;
  stellarTxHash?: string | null;
  stellarClaimableBalanceId?: string | null;
  claimTxHash?: string | null;
}

export interface BankRegistered {
  bankAccountId: string;
  status: string;
  idempotent?: boolean;
}

export type PixKeyType = 'cpf' | 'email' | 'phone' | 'evp' | 'cnpj';

export interface ClaimResult {
  claimTxHash: string;
  balanceId: string;
}

export interface SwapEnvelope {
  xdr: string;
  hashHex: string;
  /**
   * Quote a usar no submit. O build renova a cotação (recotar): é o mesmo id,
   * ou um NOVO se o quote anterior expirou. O submit usa SEMPRE este id.
   */
  quoteId: string;
  /**
   * Tokens a emitir e NAV por token do quote VIGENTE usado neste envelope
   * (strings decimais). O build renova o preço: estes valores valem mais que
   * os do /quote inicial. Contrato do Atlas (N1).
   */
  plinarfAmount: string;
  navPorTokenNaCotacao: string;
  mock: false;
}

export interface SwapMockResult {
  txHash: string;
  quoteId?: string;
  mock: true;
  alreadyExecuted: true;
}

export type SwapBuild = SwapEnvelope | SwapMockResult;

export interface BuyResult {
  swapTxHash: string;
  onRampTxHash: string | null;
  mock: boolean;
}

export interface FlowError {
  message: string;
  technical: string;
  ticketId: string;
}
