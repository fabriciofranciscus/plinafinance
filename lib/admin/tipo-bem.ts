/** Rótulo do tipo de bem para a tela do /admin (o banco guarda o código: "IMOVEL"). Desconhecido volta como veio. */
const ROTULO: Record<string, string> = { IMOVEL: 'Imóvel', VEICULO: 'Veículo', EQUIPAMENTO: 'Equipamento', SERVICO: 'Serviço' };

export function rotuloTipoBem(tipo: string): string {
  return ROTULO[tipo] ?? tipo;
}
