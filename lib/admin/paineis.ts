/**
 * Painéis do /admin (AP-3, spec da Íris §2): um painel por vez, na ordem Solicitações · Compradores · Cotas ·
 * Investidores · Resumo · Auditoria · Avulsas. Os ids são os das âncoras legadas, que continuam funcionando.
 * Função pura: só decide qual painel o hash da URL abre.
 */
export const PAINEIS_ORDEM = ['vendedores', 'compradores', 'cotas', 'investidores', 'overview', 'audit', 'incorporar'] as const;
export type IdPainel = (typeof PAINEIS_ORDEM)[number];

/** `#<painel>` abre o painel; `#lead-<id>` abre Solicitações (o detalhe é aberto pela própria lista); o resto cai em Solicitações. */
export function painelDoHash(hash: string): IdPainel {
  const h = hash.replace(/^#/, '');
  const achado = PAINEIS_ORDEM.find((id) => id === h);
  return achado ?? 'vendedores';
}
