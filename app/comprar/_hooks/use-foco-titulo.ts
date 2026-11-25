'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Foco no h1 quando a TELA muda (AP-5 /comprar, C9): a página volta ao topo e o título novo recebe o foco
 * (tabindex -1), para o leitor de tela e o teclado seguirem a jornada. Não mexe no foco na carga nem quando só os dados
 * recarregam (a chave não muda). O scroll é instantâneo: respeita `prefers-reduced-motion` por não animar.
 */
export function useFocoNoTitulo(chave: string, raiz: RefObject<HTMLElement | null>) {
  const anterior = useRef(chave);
  useEffect(() => {
    if (anterior.current === chave) return;
    anterior.current = chave;
    const el = raiz.current;
    if (!el) return;
    el.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    const h1 = (el.querySelector('main h1') ?? el.querySelector('h1')) as HTMLElement | null;
    if (!h1) return;
    h1.setAttribute('tabindex', '-1');
    h1.focus({ preventScroll: true });
  }, [chave, raiz]);
}
