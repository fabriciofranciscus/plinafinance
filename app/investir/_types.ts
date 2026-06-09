export type Screen =
  | 'welcome'
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
  entityType: EntityType;
  /** String decimal (USD ou BRL conforme a trilha). */
  estimatedTicket: string;
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
  toAmount: string;
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
  distributorSigBase64: string;
  distributorPubkey: string;
  mock: false;
}

export interface SwapMockResult {
  txHash: string;
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
