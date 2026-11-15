/**
 * Itens do menu principal (spec de UX da Íris, 15/11, §1.1). Função pura: o
 * AppHeader só renderiza o que ela devolve.
 *
 * - Admin e deslogado mantêm o menu de hoje.
 * - Logado: Início · Investir (testnet) · Sacar (testnet) · Vender ·
 *   Minhas solicitações · Histórico.
 * - Papéis ainda carregando: só Início e Histórico (comuns a todos); os demais
 *   entram quando o PessoaProvider responder.
 * - Conta sem papel: Início · Investir · Vender · Histórico (não deixa quem
 *   chega para vender sem caminho).
 */

export interface ItemMenu {
  href: string;
  label: string;
}

export interface EntradaMenu {
  isAdmin: boolean;
  authenticated: boolean;
  /** `PessoaProvider` ainda está lendo os papéis. */
  carregandoPapeis: boolean;
  papeis: readonly string[];
}

const PUBLICO: ItemMenu[] = [
  { href: '/pool', label: 'Pool' },
  { href: '/cotas', label: 'Cotas' },
  { href: '/politica-clawback', label: 'Política' },
];

export function itensDoMenu({ isAdmin, authenticated, carregandoPapeis, papeis }: EntradaMenu): ItemMenu[] {
  if (isAdmin) return [{ href: '/admin', label: 'Operação' }, { href: '/pool', label: 'Pool' }];
  if (!authenticated) return [...PUBLICO, { href: '/investir', label: 'Investir (testnet)' }];

  const inicio: ItemMenu = { href: '/inicio', label: 'Início' };
  const historico: ItemMenu = { href: '/historico', label: 'Histórico' };
  if (carregandoPapeis) return [inicio, historico];

  const investidor = papeis.includes('INVESTIDOR');
  const cedente = papeis.includes('CEDENTE');
  const semPapel = !investidor && !cedente;

  return [
    inicio,
    ...(investidor || semPapel ? [{ href: '/investir', label: 'Investir (testnet)' }] : []),
    ...(investidor ? [{ href: '/sacar', label: 'Sacar (testnet)' }] : []),
    ...(cedente || semPapel ? [{ href: '/vender', label: 'Vender' }] : []),
    ...(cedente ? [{ href: '/vender/minhas', label: 'Minhas solicitações' }] : []),
    historico,
  ];
}

/** Só o link mais específico acende (ex.: /vender/minhas não acende também /vender). */
export function itemAtivo(href: string, pathname: string, itens: readonly ItemMenu[]): boolean {
  const casa = (h: string) => pathname === h || (h !== '/' && pathname.startsWith(h + '/'));
  return casa(href) && !itens.some((o) => o.href.length > href.length && casa(o.href));
}
