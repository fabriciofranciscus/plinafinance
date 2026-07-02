/**
 * Datas de nascimento vêm como string ISO `YYYY-MM-DD` (input HTML `type=date`).
 * `new Date('YYYY-MM-DD')` parseia como UTC meia-noite — comparar os
 * componentes disso contra `Date.getMonth()/getDate()` (que são *locais*)
 * dá resultado errado (off-by-one) em qualquer timezone que não seja UTC.
 * Por isso aqui os componentes da data são extraídos por regex, nunca via
 * `new Date(dataISO)`, e todo o resto do módulo trabalha só com componentes
 * locais (ano/mês/dia) — sem depender de conversão UTC↔local.
 */
function parseDataISO(dataISO: string): { ano: number; mes: number; dia: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataISO.trim());
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]) - 1;
  const dia = Number(m[3]);
  const d = new Date(ano, mes, dia);
  // Detecta datas que não existem (ex.: 2023-02-30) — o construtor de Date
  // "rola" pro mês seguinte em vez de rejeitar.
  if (d.getFullYear() !== ano || d.getMonth() !== mes || d.getDate() !== dia) return null;
  return { ano, mes, dia };
}

/** Idade em anos completos a partir de uma data ISO (YYYY-MM-DD). `NaN` se a
 *  data for inválida — chamador decide como tratar. */
export function idadeAnos(dataISO: string, hoje: Date = new Date()): number {
  const nascimento = parseDataISO(dataISO);
  if (!nascimento) return NaN;
  let idade = hoje.getFullYear() - nascimento.ano;
  const aniversarioEsteAno = new Date(hoje.getFullYear(), nascimento.mes, nascimento.dia);
  if (hoje < aniversarioEsteAno) idade -= 1;
  return idade;
}

/** KYC (AML/COAF) exige maioridade — usado tanto no client (feedback
 *  imediato) quanto no server (defesa em profundidade, já que validação
 *  client-side é sempre contornável). */
export function isMaiorDeIdade(dataISO: string, hoje?: Date): boolean {
  const idade = idadeAnos(dataISO, hoje);
  return Number.isFinite(idade) && idade >= 18;
}

/** Data ISO de 18 anos atrás — usada no `max` do `<input type="date">` pra
 *  o próprio seletor nativo já impedir escolher uma data muito recente.
 *  Monta a string manualmente (não via `toISOString`) pra não sofrer o
 *  mesmo deslocamento UTC↔local descrito no topo do arquivo. */
export function dataMaximaNascimentoISO(hoje: Date = new Date()): string {
  const ano = hoje.getFullYear() - 18;
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const dia = String(hoje.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}
