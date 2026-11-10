'use client';

/**
 * Raiz da landing v2: provedor de movimento (pausa) e revelação ao rolar.
 * SPEC §5.2 e §5.6. O estado oculto só existe sob `reveal-ready` na raiz do
 * documento, posta pelo script do <head> antes da pintura (RevealHeadScript);
 * as regras de segurança abaixo garantem que nada fique preso invisível.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface MotionState {
  paused: boolean;
  toggle: () => void;
}

const MotionContext = createContext<MotionState>({ paused: false, toggle: () => {} });
export const useMotion = () => useContext(MotionContext);

export function LandingRoot({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stopRevealRef = useRef<() => void>(() => {});

  // Preferência do sistema: com movimento reduzido o botão já nasce pausado.
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    setPaused(media.matches);
    const onChange = () => setPaused(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('motion-paused', paused);
    if (paused) stopRevealRef.current();
  }, [paused]);

  // Revelação ao rolar.
  useEffect(() => {
    const scope = rootRef.current;
    if (!scope) return;
    const html = document.documentElement;
    const pending = new Set<Element>(
      Array.from(scope.querySelectorAll('[data-r]')).filter((e) => !e.classList.contains('is-in')),
    );
    let observer: IntersectionObserver | null = null;
    const timers: number[] = [];

    function show(el: Element, delay: number) {
      if (!pending.delete(el)) return;
      observer?.unobserve(el);
      if (delay) (el as HTMLElement).style.setProperty('--d', `${delay}s`);
      el.classList.add('is-in');
      // 6: passados 2,6 s o bloco deixa as transições de entrada (hover sem atraso)
      timers.push(
        window.setTimeout(() => {
          el.classList.add('is-done');
          (el as HTMLElement).style.removeProperty('--d');
        }, 2600 + delay * 1000),
      );
    }
    function showAll() {
      pending.forEach((el) => el.classList.add('is-in', 'is-done'));
      pending.clear();
      observer?.disconnect();
    }
    function stopReveal() {
      showAll();
      html.classList.remove('reveal-ready');
    }
    stopRevealRef.current = stopReveal;
    // O script do <head> espera este sinal; sem ele retira `reveal-ready` aos 4 s.
    (window as unknown as { plinaReveal?: boolean }).plinaReveal = true;

    const cleanups: Array<() => void> = [];
    if (html.classList.contains('reveal-ready')) {
      // Um bloco entra quando o topo está claramente na área visível; os que
      // entram juntos escalonam 90 ms (até 450 ms). 3: o que já ficou acima da
      // área visível aparece sem animação.
      observer = new IntersectionObserver(
        (entries) => {
          let order = 0;
          entries.forEach((entry) => {
            if (entry.isIntersecting) show(entry.target, Math.min(order++, 5) * 0.09);
            else if (entry.boundingClientRect.bottom <= 0) show(entry.target, 0);
          });
        },
        { threshold: 0, rootMargin: '0px 0px -12% 0px' },
      );
      pending.forEach((el) => observer!.observe(el));
      // 4: foco dentro de um bloco oculto revela o bloco na hora.
      const onFocusIn = (event: FocusEvent) =>
        pending.forEach((el) => {
          if (el.contains(event.target as Node)) show(el, 0);
        });
      // 5: chegar ao fim revela o que restar; antes de imprimir, tudo aparece.
      const onScroll = () => {
        if (pending.size && innerHeight + scrollY >= html.scrollHeight - 8) showAll();
      };
      document.addEventListener('focusin', onFocusIn);
      addEventListener('beforeprint', stopReveal);
      addEventListener('scroll', onScroll, { passive: true });
      cleanups.push(
        () => document.removeEventListener('focusin', onFocusIn),
        () => removeEventListener('beforeprint', stopReveal),
        () => removeEventListener('scroll', onScroll),
      );
    } else {
      showAll();
    }
    return () => {
      observer?.disconnect();
      cleanups.forEach((fn) => fn());
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  const toggle = useCallback(() => setPaused((p) => !p), []);
  const value = useMemo(() => ({ paused, toggle }), [paused, toggle]);

  return (
    <MotionContext.Provider value={value}>
      <div ref={rootRef} className="ld">
        {children}
      </div>
    </MotionContext.Provider>
  );
}
