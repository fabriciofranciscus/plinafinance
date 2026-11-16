/** Formatação de EXIBIÇÃO (pt-BR). Os valores chegam prontos do servidor; aqui só se formata, nada se calcula. */

const num = (s: string | null | undefined): number | null => {
  if (s === null || s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const NUM4 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const BRL2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BRL4 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4, maximumFractionDigits: 4 });
const BRL0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** PLINA-RF e quantidades: 4 casas (decisão do Atlas, 13/11). */
export const fmtTokens = (s: string | null | undefined) => (num(s) === null ? '—' : NUM4.format(num(s)!));
/** Reais com 2 casas. */
export const fmtBrl = (s: string | null | undefined) => (num(s) === null ? '—' : BRL2.format(num(s)!));
/** Reais sem centavos (valor da carta). */
export const fmtBrlInteiro = (s: string | null | undefined) => (num(s) === null ? '—' : BRL0.format(num(s)!));
/** Percentual em pt-BR: 2 casas, vírgula e símbolo colado ("0,03%"). Só exibição. */
const PCT2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPct = (n: number) => (Number.isFinite(n) ? `${PCT2.format(n)}%` : '—');

/** NAV por token: 4 casas. */
export const fmtNavToken = (s: string | null | undefined) => (num(s) === null ? '—' : BRL4.format(num(s)!));

export const fmtDataHora = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

export const explorerTx = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const hashCurto = (hash: string) => `${hash.slice(0, 4)}…${hash.slice(-4)}`;

/** Nome para o cabeçalho: nunca e-mail nem vazio. */
export const nomeExibivel = (nome: string | null | undefined): string | null =>
  nome && !nome.includes('@') && nome.trim() ? nome.trim() : null;
