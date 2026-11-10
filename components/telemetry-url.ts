/**
 * Vercel Analytics e Speed Insights enviam a URL da página. Query string e
 * hash podem carregar dado pessoal (ex.: formulário enviado sem JavaScript,
 * link com e-mail), então saem antes do envio. Decisão da Thais/Atlas (LD3).
 */
export function stripUrlQueryAndHash(url: string): string {
  const semHash = url.split('#')[0] ?? url;
  return semHash.split('?')[0] ?? semHash;
}

/** `beforeSend` das duas bibliotecas: mesma regra para `url` e, se houver, `route`. */
export function sanitizeTelemetryEvent<T extends { url: string; route?: string }>(event: T): T {
  const limpo: T = { ...event, url: stripUrlQueryAndHash(event.url) };
  if (typeof event.route === 'string') limpo.route = stripUrlQueryAndHash(event.route);
  return limpo;
}
