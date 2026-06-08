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

export interface OnboardData {
  investidorId: string;
  publicKey: string;
  etherfuseCustomerId: string;
  kycStatus: 'approved' | 'pending' | 'not_started';
  fundedNow: boolean;
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
