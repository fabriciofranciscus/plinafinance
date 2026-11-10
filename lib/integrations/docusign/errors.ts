/**
 * Erros do cliente DocuSign. As mensagens são em português, acionáveis e NUNCA
 * carregam corpo de resposta, token, chave ou dados do signatário (PII).
 */

export type CodigoErroDocusign =
  | 'CONFIG_INVALIDA'
  | 'CHAVE_PRIVADA_INVALIDA'
  | 'CONSENTIMENTO_NECESSARIO'
  | 'AUTENTICACAO_FALHOU'
  | 'ENTRADA_INVALIDA'
  | 'ENVELOPE_NAO_ENCONTRADO'
  | 'REQUISICAO_REJEITADA'
  | 'INDISPONIVEL'
  | 'RESPOSTA_INVALIDA';

export class DocusignError extends Error {
  readonly codigo: CodigoErroDocusign;
  readonly httpStatus?: number;

  constructor(codigo: CodigoErroDocusign, mensagem: string, httpStatus?: number) {
    super(mensagem);
    this.name = 'DocusignError';
    this.codigo = codigo;
    this.httpStatus = httpStatus;
  }
}

/** Consentimento (signature impersonation) ainda não concedido para o usuário do JWT. */
export class DocusignConsentRequiredError extends DocusignError {
  constructor() {
    super(
      'CONSENTIMENTO_NECESSARIO',
      'DocuSign: o usuário da integração ainda não concedeu consentimento (escopo "signature impersonation"). ' +
        'No painel do desenvolvedor (Apps and Keys), abra a integração e conceda o consentimento, ' +
        'ou peça ao administrador da conta que o faça; depois repita a operação.',
      400,
    );
    this.name = 'DocusignConsentRequiredError';
  }
}
