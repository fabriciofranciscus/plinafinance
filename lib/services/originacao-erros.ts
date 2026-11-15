/**
 * Pré-condições do funil de originação que o OPERADOR pode corrigir (item 14 / G5). Antes eram `Error` simples e a rota admin
 * respondia 500 sem `code`; agora a rota as mapeia: `NAO_ENCONTRADO` → 404, as demais → 409. As mensagens são FIXAS (sem dado
 * de ninguém: nada de e-mail, nome, CPF, id ou hash na mensagem) e ficam iguais às de antes.
 */
export type OriginacaoPrecondicaoCode =
  | 'OFERTA_NAO_ENCONTRADA'
  | 'CESSAO_NAO_ENCONTRADA'
  | 'LAUDO_NAO_ENCONTRADO'
  | 'LEAD_NAO_ENCONTRADO'
  | 'OFERTA_NAO_ACEITA'
  | 'CESSAO_JA_TEM_COTA'
  | 'CESSAO_ESTADO_INVALIDO'
  | 'CEDENTE_SEM_EMAIL'
  | 'ANUENCIA_SEM_REFERENCIA'
  | 'ANUENCIA_DECLARADA_EM_MAINNET';

export class OriginacaoPrecondicaoError extends Error {
  constructor(
    readonly code: OriginacaoPrecondicaoCode,
    message: string,
  ) {
    super(message);
    this.name = 'OriginacaoPrecondicaoError';
  }

  /** 404 para "não existe"; 409 para "existe, mas o estado atual não permite". */
  get status(): 404 | 409 {
    return this.code.endsWith('_NAO_ENCONTRADA') || this.code.endsWith('_NAO_ENCONTRADO') ? 404 : 409;
  }
}
