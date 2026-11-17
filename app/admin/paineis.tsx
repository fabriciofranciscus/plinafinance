'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PAINEIS_ORDEM, painelDoHash, type IdPainel } from '@/lib/admin/paineis';

export interface PainelAdmin {
  id: IdPainel;
  /** Nome na navegação (mantém o nome atual, com a contagem quando existe). */
  rotulo: string;
  /** Conteúdo já renderizado no servidor; só o invólucro de navegação é novo. */
  conteudo: ReactNode;
}

/**
 * Um painel por vez (AP-3). Os painéis ficam montados (estado de filtro, seleção e formulário se preserva) e os
 * inativos recebem `hidden`: saem da ordem de foco e da árvore acessível. Navegação por hash: histórico do
 * navegador, âncoras legadas e nenhum dado na URL. Trocar de painel não envia nada nem chama a API.
 */
export function PaineisAdmin({ paineis }: { paineis: PainelAdmin[] }) {
  const [ativo, setAtivo] = useState<IdPainel>('vendedores');
  const raiz = useRef<HTMLDivElement>(null);
  // Só leva o foco ao título quando a pessoa trocou de painel, não na carga da página.
  const focar = useRef(false);

  useEffect(() => {
    const aplicar = (deUsuario: boolean) => {
      focar.current = deUsuario;
      setAtivo(painelDoHash(window.location.hash));
    };
    aplicar(false);
    const aoMudar = () => aplicar(true);
    window.addEventListener('hashchange', aoMudar);
    return () => window.removeEventListener('hashchange', aoMudar);
  }, []);

  useEffect(() => {
    if (!focar.current) return;
    focar.current = false;
    // O título do painel é o h2; em Avulsas é o <summary> do <details> (não há h2).
    const painel = raiz.current?.querySelector(`[data-painel="${ativo}"]`);
    const titulo = painel?.querySelector<HTMLElement>('h2') ?? painel?.querySelector<HTMLElement>('summary') ?? null;
    if (titulo) {
      titulo.setAttribute('tabindex', '-1');
      titulo.focus();
    }
  }, [ativo]);

  const ordenados = PAINEIS_ORDEM.map((id) => paineis.find((p) => p.id === id)).filter((p): p is PainelAdmin => !!p);

  return (
    <div ref={raiz}>
      <div className="sticky top-14 z-30 -mx-[var(--spacing-gutter-ui)] px-[var(--spacing-gutter-ui)] mb-8 bg-lightBg/95 backdrop-blur border-b border-light-hairline">
        {/* Celular e tablet (< 1024): seletor nativo com o valor atual. */}
        <div className="lg:hidden py-2">
          <label htmlFor="admin-secao" className="block font-details text-label-ui text-base/70 mb-1">
            Seção
          </label>
          <select
            id="admin-secao"
            value={ativo}
            onChange={(e) => {
              window.location.hash = e.target.value;
            }}
            className="w-full min-h-[44px] rounded-full bg-white border border-base/40 px-4 font-text text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-700 focus-visible:ring-offset-2"
          >
            {ordenados.map((p) => (
              <option key={p.id} value={p.id}>
                {p.rotulo}
              </option>
            ))}
          </select>
        </div>
        {/* A partir de 1024: links de seção; não finge tabs ARIA (sem teclado completo de tabs). */}
        <nav aria-label="Seções do painel" className="hidden lg:block">
          <ul className="flex gap-2 overflow-x-auto py-2">
            {ordenados.map((p) => (
              <li key={p.id}>
                <a
                  href={`#${p.id}`}
                  aria-current={p.id === ativo ? 'true' : undefined}
                  className={`inline-flex min-h-[44px] items-center whitespace-nowrap font-details text-label-ui px-3 border-b-2 hover:text-base transition-colors duration-[var(--duration-fast)] ease-terminal focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal-700 ${
                    p.id === ativo ? 'border-base text-base' : 'border-transparent text-base/70'
                  }`}
                >
                  {p.rotulo}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {ordenados.map((p) => (
        <div key={p.id} data-painel={p.id} role="region" aria-label={p.rotulo} hidden={p.id !== ativo}>
          {p.conteudo}
        </div>
      ))}
    </div>
  );
}
