/**
 * Nome do cedente (pós-cota 15/11, Atlas): o e-mail NUNCA é usado como nome. `Pessoa.nome` é obrigatório no schema e, sem
 * nome informado no onboarding, nasce com o e-mail (`ensureKycForPessoa`); dali o e-mail ia para o lead, a saudação dos
 * e-mails e o PDF da cessão. `nomeDoCedente` devolve o nome utilizável ou `null` (vazio, parecido com e-mail ou o marcador
 * de "sem nome"), e cada ponto decide: o e-mail cumprimenta de forma neutra e o instrumento recusa (exige o nome do KYC).
 */

/** Marcador gravado em `LeadVendedor.nome` (coluna obrigatória) quando a Pessoa não tem nome de verdade. */
export const NOME_NAO_INFORMADO = 'Nome não informado';

export function nomeDoCedente(nome: string | null | undefined): string | null {
  const n = (nome ?? '').trim();
  if (!n || n.includes('@') || n === NOME_NAO_INFORMADO) return null;
  return n;
}
