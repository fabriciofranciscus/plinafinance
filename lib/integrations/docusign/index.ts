/**
 * Porta de entrada da integração DocuSign. lib/services importa só daqui.
 * Instância única, configurada pelo ambiente (DOCUSIGN_*), carregada sob demanda.
 */

import { criarClienteDocusign, type ClienteDocusign, type CriarEnvelopeInput } from './client';

export { criarClienteDocusign, normalizarStatusEnvelope } from './client';
export type { ClienteDocusign, CriarEnvelopeInput, StatusEnvelope } from './client';
export { transactionIdDeterministico } from './transaction-id';
export { verificarHmacConnect } from './connect-hmac';
export { DocusignConsentRequiredError, DocusignError } from './errors';
export type { CodigoErroDocusign } from './errors';

let padrao: ClienteDocusign | undefined;
const cliente = (): ClienteDocusign => (padrao ??= criarClienteDocusign());

export const obterTokenDocusign = () => cliente().obterToken();
export const criarEnvelope = (entrada: CriarEnvelopeInput) => cliente().criarEnvelope(entrada);
export const obterStatusEnvelope = (envelopeId: string) => cliente().obterStatusEnvelope(envelopeId);
export const baixarDocumentoAssinado = (envelopeId: string) => cliente().baixarDocumentoAssinado(envelopeId);
