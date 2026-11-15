/**
 * Consentimento LGPD do cedente (A-11, decisão do Atlas 15/11; condições da Consuelo).
 *
 *  - A VERSÃO é o SHA-256 do TEXTO exato (`TEXTO_CONSENTIMENTO_LGPD`), não um rótulo: mudou uma letra do texto, mudou a versão.
 *    A tela do /vender deve renderizar ESTA constante (única fonte), para o hash ancorado ser o do texto que a pessoa viu.
 *  - A prova on-chain é ancorada só na 1ª captura do lead ou quando a versão (ou a origem) muda; reenvio com os mesmos dados
 *    grava `LEAD_VENDEDOR_REAPROVEITADO` (sem memo, sem fee, sem PII).
 *  - O titular entra no payload ancorado como PSEUDÔNIMO (HMAC-SHA256 do e-mail com segredo do servidor), nunca o e-mail em
 *    claro: o SHA-256 de um e-mail é reverificável por quem tenha um e-mail candidato.
 *
 * ⚠ O TEXTO ABAIXO É PROVISÓRIO (descreve o tratamento como o sistema o faz hoje, não é texto jurídico aprovado). Enquanto
 * `TEXTO_CONSENTIMENTO_APROVADO` for false, a captura é RECUSADA na mainnet (fail-closed). Norma/Consuelo entregam o texto
 * aprovado; quem o troca aqui põe a flag em true NO MESMO commit.
 */

import { createHash, createHmac } from 'node:crypto';

export const TEXTO_CONSENTIMENTO_LGPD =
  'Autorizo a Plina Finance a tratar meus dados de identificação e de contato para analisar a minha solicitação de venda de cota ' +
  'de consórcio. Autorizo também o registro, em rede pública (Stellar), apenas de um código (hash) que comprova este ' +
  'consentimento, sem meus dados pessoais. Posso revogar o consentimento a qualquer momento.';

/** `true` só depois de Norma/Consuelo aprovarem o texto acima. */
export const TEXTO_CONSENTIMENTO_APROVADO = false;

/** Versão = SHA-256 (hex) do texto exato exibido. */
export const VERSAO_CONSENTIMENTO_LGPD = createHash('sha256').update(TEXTO_CONSENTIMENTO_LGPD, 'utf8').digest('hex');

/** Marcador de eventos anteriores à versão: o texto daquela época não existe e não é reconstruído. */
export const VERSAO_LEGADO = 'legado';

const SEGREDO_MIN = 32;

/**
 * Pseudônimo do titular: HMAC-SHA256 (hex) do e-mail normalizado com `CONSENTIMENTO_HMAC_SECRET` (≥ 32 caracteres, só no
 * servidor). Sem segredo válido devolve `null` (o chamador decide: recusa na mainnet).
 */
export function pseudonimoDoTitular(emailNormalizado: string, segredo: string | undefined = process.env.CONSENTIMENTO_HMAC_SECRET): string | null {
  const s = (segredo ?? '').trim();
  if (s.length < SEGREDO_MIN) return null;
  return createHmac('sha256', s).update(`consentimento-lead-vendedor:${emailNormalizado}`).digest('hex');
}
