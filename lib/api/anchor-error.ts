/**
 * Erro do anchor (Etherfuse) nunca sobe cru para a rota: viraria 500 INTERNAL e o usuário/QA não saberia a causa (hotfix #97, e o
 * onramp/create da Vera: "Terms and conditions have not been completed" saía como 500).
 *   - 4xx do anchor (dado ou cadastro recusado)  → 422 `VALIDATION_FAILED` com mensagem FIXA;
 *   - qualquer outro erro do anchor (5xx, rede)   → 502 `ETHERFUSE_ERROR` com mensagem FIXA.
 * O texto do upstream NÃO vai ao cliente nem ao log (pode ecoar e-mail, chave Pix, CPF); só `code` e status do AnchorError vão ao log.
 * Erros que não são do anchor voltam como estão (o chamador decide).
 */
import { AnchorError } from '@/lib/anchors/types';
import { ApiError } from './errors';

export const MSG_ANCHOR_4XX_PADRAO = 'A Etherfuse recusou a operação. Complete o seu cadastro e confira os dados antes de tentar de novo.';
export const MSG_ANCHOR_INDISPONIVEL = 'A Etherfuse não respondeu como esperado agora. Nada foi enviado. Tente novamente em instantes.';

export function erroDoAnchor(err: unknown, etapa: string, msg4xx: string = MSG_ANCHOR_4XX_PADRAO): unknown {
  if (!(err instanceof AnchorError)) return err;
  console.error(`[anchor] ${etapa}`, { code: err.code, status: err.statusCode });
  if (err.statusCode >= 400 && err.statusCode < 500) return new ApiError('VALIDATION_FAILED', 422, msg4xx);
  return new ApiError('ETHERFUSE_ERROR', 502, MSG_ANCHOR_INDISPONIVEL);
}
