/**
 * `<input type="number">` aceita "1e3", "1e-7", "+" e "-": notação que os servidores recusam (ou, no clawback, que o SDK
 * da Stellar aceitava como número). Nos campos de valor não existe quantidade negativa nem notação científica, então a
 * tela bloqueia essas teclas. Só digitação: colar "1e3" ainda chega ao servidor, que recusa com a mensagem dele.
 * Uso: `<input type="number" onKeyDown={semNotacaoCientifica} />`.
 */
export function semNotacaoCientifica(e: { key: string; preventDefault: () => void }): void {
  if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') e.preventDefault();
}
