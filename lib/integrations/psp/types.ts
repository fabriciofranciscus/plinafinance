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
  return r.data;
}

export const ID_TRANSFERENCIA = /^[A-Za-z0-9_-]{1,64}$/;
