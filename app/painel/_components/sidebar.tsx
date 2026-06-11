'use client';

/**
 * Sidebar do painel — 6 telas com a assinatura Plina (barra cyan scaleY no
 * item ativo) + card de identidade no rodapé. Em telas pequenas vira uma barra
 * de tabs horizontal com scroll-x (sem o card de identidade).
 */

export type ViewId =
  | 'overview'
  | 'cotas'
  | 'kyc'
  | 'transactions'
  | 'distributions'
  | 'documents';

export const NAV_DEFS: { id: ViewId; label: string }[] = [
  { id: 'overview', label: 'Visão Geral' },
  { id: 'cotas', label: 'Minhas Cotas' },
  { id: 'kyc', label: 'KYC & Compliance' },
  { id: 'transactions', label: 'Transações' },
  { id: 'distributions', label: 'Distribuições' },
  { id: 'documents', label: 'Documentos' },
];

interface SidebarProps {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  nome: string | null;
  papelLabel: string;
}

export default function Sidebar({
  active,
  onSelect,
  nome,
  papelLabel,
}: SidebarProps) {
  const initials = (nome ?? 'Investidor')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <aside className="md:w-[236px] md:flex-shrink-0 md:sticky md:top-6 md:self-start bg-white border border-light-hairline md:flex md:flex-col">
      <div className="hidden md:block px-5 pt-6 pb-2">
        <div className="font-details text-[9px] font-bold tracking-[0.24em] uppercase text-base/40">
          Painel
        </div>
      </div>

      {/* Desktop: lista vertical. Mobile: barra horizontal com scroll. */}
      <nav className="flex md:flex-col overflow-x-auto md:overflow-visible">
        {NAV_DEFS.map((t) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex items-center whitespace-nowrap px-5 py-3 md:pl-6 text-left font-details text-[11px] font-semibold tracking-[0.12em] uppercase transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                isActive
                  ? 'text-base bg-base/5'
                  : 'text-base/50 hover:text-base hover:bg-base/[0.03]'
              }`}
            >
              <span
                aria-hidden
                className={`absolute left-0 top-0 bottom-0 w-[2px] bg-primary origin-top transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                  isActive ? 'scale-y-100' : 'scale-y-0'
                }`}
              />
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="hidden md:flex md:mt-auto items-center gap-3 px-5 py-4 border-t border-light-hairline">
        <div className="w-9 h-9 flex-shrink-0 bg-base flex items-center justify-center font-mono text-xs text-secondaryLight">
          {initials || 'IN'}
        </div>
        <div className="min-w-0">
          <div className="font-title text-sm font-semibold text-base truncate">
            {nome ?? 'Investidor'}
          </div>
          <div className="font-details text-[9px] font-bold tracking-[0.16em] uppercase text-base/45 mt-0.5">
            {papelLabel}
          </div>
        </div>
      </div>
    </aside>
  );
}
