/**
 * Porta de liquidação (E1-2): Pix de SAÍDA ao titular. Contrato: contratos/2026-11-11-e1-2-psp-pix-saida.md.
 * Serviço nunca importa SDK/HTTP de PSP: usa esta porta; a chamada concreta vive nos arquivos deste diretório.
 */
import { z } from 'zod';

export type TipoChavePix = 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';
export type StatusPix = 'PENDENTE' | 'CONCLUIDO' | 'FALHOU' | 'CANCELADO';

export interface PixProvider {
  readonly nome: 'ASAAS' | 'SIMULADO';
  enviarPix(i: EnvioPix): Promise<{ id: string; status: StatusPix }>;
  consultarStatus(id: string): Promise<ConsultaPix>;
  /** Recuperação após resposta ambígua: acha a transferência que NÓS pedimos, por idempotencyKey (casamento no cliente). */
  localizarPorChave(idempotencyKey: string, desde: Date): Promise<{ id: string; status: StatusPix } | null>;
}

export interface EnvioPix {
  /** BRL com 2 casas, ex.: "123.45". */
  valor: string;
  chavePix: string;
  tipoChave: TipoChavePix;
  idempotencyKey: string;
  descricao?: string;
}

export interface ConsultaPix {
  id: string;
  status: StatusPix;
  valor?: string;
  e2eId?: string | null;
  efetivadoEm?: string | null;
  motivoFalha?: string | null;
}

export type PspErrorCode = 'PSP_CONFIG' | 'PSP_RECUSOU' | 'PSP_INCERTO' | 'PSP_RESPOSTA_INVALIDA';

const MENSAGENS: Record<PspErrorCode, string> = {
  PSP_CONFIG: 'PSP indisponível: configuração ausente ou não permitida (só sandbox).',
  PSP_RECUSOU: 'O PSP recusou o pedido; nada foi enviado.',
  PSP_INCERTO: 'O PSP não confirmou o pedido; o Pix pode ter saído. Não reenvie sem conferir.',
  PSP_RESPOSTA_INVALIDA: 'Resposta do PSP inválida.',
};

/** Mensagem constante: nunca carrega chave Pix, corpo do PSP nem segredo. */
export class PspError extends Error {
  constructor(readonly code: PspErrorCode, options?: { cause?: unknown }) {
    super(MENSAGENS[code], options);
    this.name = 'PspError';
  }
}

export const envioPixSchema = z.strictObject({
  valor: z.string().regex(/^\d{1,13}\.\d{2}$/).refine((v) => Number(v) > 0, 'valor deve ser > 0'),
  chavePix: z.string().min(1).max(140),
  tipoChave: z.enum(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP']),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{8,100}$/),
  descricao: z.string().max(140).optional(),
});

/** Valida a entrada (Zod strict); falha = `PSP_RECUSOU` sem repetir o conteúdo (pode ter chave Pix). */
export function validarEnvio(i: EnvioPix): EnvioPix {
  const r = envioPixSchema.safeParse(i);
  if (!r.success) throw new PspError('PSP_RECUSOU');
  const chave = validarChavePix(r.data.tipoChave, r.data.chavePix);
  if (!chave) throw new PspError('PSP_RECUSOU');
  return { ...r.data, chavePix: chave };
}

function digitosVerificadoresOk(d: string, pesos: number[][]): boolean {
  return pesos.every((p, k) => {
    const soma = p.reduce((acc, peso, idx) => acc + Number(d[idx]) * peso, 0);
    const resto = soma % 11;
    return Number(d[p.length]) === (resto < 2 ? 0 : 11 - resto);
  });
}
const PESOS_CPF = [[10, 9, 8, 7, 6, 5, 4, 3, 2], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]];
const PESOS_CNPJ = [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]];

/**
 * Valida a chave Pix pelo tipo ANTES de qualquer claim ou envio (uma chave com erro de digitação não deve
 * queimar a tentativa nem chegar ao PSP). Devolve a chave NORMALIZADA (CPF/CNPJ/telefone só dígitos; e-mail
 * minúsculo; EVP minúsculo) ou `null` se inválida. CPF/CNPJ com dígito verificador; telefone 11 dígitos com DDD
 * (formato exigido pelo Asaas).
 */
export function validarChavePix(tipo: TipoChavePix, chave: string): string | null {
  const c = chave.trim();
  switch (tipo) {
    case 'CPF': {
      const d = c.replace(/[.\-\s]/g, '');
      if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return null;
      return digitosVerificadoresOk(d, PESOS_CPF) ? d : null;
    }
    case 'CNPJ': {
      const d = c.replace(/[.\-/\s]/g, '');
      if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return null;
      return digitosVerificadoresOk(d, PESOS_CNPJ) ? d : null;
    }
    case 'PHONE': {
      const d = c.replace(/[()\-\s]/g, '');
      return /^[1-9]\d{10}$/.test(d) ? d : null;
    }
    case 'EMAIL':
      return c.length <= 77 && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(c) ? c.toLowerCase() : null;
    case 'EVP':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c) ? c.toLowerCase() : null;
  }
}

/**
 * Trava de mainnet (P1 do Argus): hoje só existem provedores de SANDBOX/SIMULADO. Em `STELLAR_NETWORK=PUBLIC` nenhum
 * deles pode ser criado, senão uma transferência "comprovada" e ancorada seria só de mentira. Lê o env a cada chamada.
 */
/** Mesma leitura do `lib/stellar/config.ts`: só o valor exato `PUBLIC` é a mainnet (qualquer outro valor roda na testnet). */
export function redeEhPublica(): boolean {
  return process.env.STELLAR_NETWORK === 'PUBLIC';
}

export function exigirRedeDeTeste(): void {
  if (redeEhPublica()) throw new PspError('PSP_CONFIG');
}

export const ID_TRANSFERENCIA = /^[A-Za-z0-9_-]{1,64}$/;
