/**
 * Rotas que o BotID do CLIENTE protege — arquivo SEM dependência de servidor (`botid/server`), para o layout e o
 * `instrumentation-client.ts` poderem importá-lo. `/api/comprar/lead` (anônima: grava lead e memo on-chain) entra SEMPRE;
 * `/api/vender/lead` (exige login e KYC) só quando a flag do cliente `NEXT_PUBLIC_BOTID_ENFORCE`, lida no BUILD, não é a
 * string exata 'false' (hotfix 14/11, Atlas; B1 do Argus). Fail-closed: qualquer outro valor mantém a proteção.
 */

export type RotaProtegidaBotId = { path: string; method: 'POST' };

export function botIdProtegidos(flagCliente: string | undefined): RotaProtegidaBotId[] {
  const rotas: RotaProtegidaBotId[] = [{ path: '/api/comprar/lead', method: 'POST' }];
  if (flagCliente !== 'false') rotas.unshift({ path: '/api/vender/lead', method: 'POST' });
  return rotas;
}
