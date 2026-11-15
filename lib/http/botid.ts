/**
 * BotID atrás de flag SÓ para `POST /api/vender/lead` (hotfix 14/11, Atlas; B1 do Argus): em produção o desafio do BotID
 * prendia esse POST e bloqueava a cota de prova. A verificação continua LIGADA por padrão (fail-closed): só o valor EXATO
 * `BOTID_ENFORCE === 'false'` a desliga; ausente, vazio, 'FALSE', ' false', '0' ou qualquer outra coisa = checa. O rate limit
 * e o resto da validação da rota NÃO dependem desta flag. `/api/comprar/lead` é ANÔNIMA (grava lead e memo on-chain) e NÃO
 * usa esta flag: segue sempre com `checkBotId` direto. O cliente tem a flag própria NEXT_PUBLIC_BOTID_ENFORCE (layout.tsx
 * e instrumentation-client.ts), também só para o path /api/vender/lead.
 */

import { checkBotId } from 'botid/server';

export function botIdAtivo(env: string | undefined = process.env.BOTID_ENFORCE): boolean {
  return env !== 'false';
}

/** `true` = a requisição deve ser recusada (403). Com a flag desligada nem chama o BotID. */
export async function requisicaoEhBot(): Promise<boolean> {
  if (!botIdAtivo()) return false;
  // extraAllowedHosts cobre o alias www (2026-07-01 — ver BotIdClient em app/layout.tsx).
  return (await checkBotId({ advancedOptions: { extraAllowedHosts: ['www.plina.finance'] } })).isBot;
}
