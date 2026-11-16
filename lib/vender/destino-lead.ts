/**
 * Destino depois de "Enviar e acompanhar" (A-11, Bento): POST /api/vender/lead devolve
 * `reaproveitada` e `statusAtual`. Com solicitação já aberta o id é o mesmo e a pessoa é
 * avisada; com a anterior encerrada (PERDIDO) a própria página já diz "Solicitação
 * encerrada", então nenhum aviso de "abrimos a mesma" é acrescentado.
 */
export function destinoAposEnvio(r: { leadId: string; reaproveitada?: boolean; statusAtual?: string | null }): string {
  const base = `/vender/acompanhar/${r.leadId}`;
  return r.reaproveitada && r.statusAtual !== 'PERDIDO' ? `${base}?aviso=reaproveitada` : base;
}
