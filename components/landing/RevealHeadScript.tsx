/**
 * Roda antes da primeira pintura da landing (SPEC §5.2, regras 1 e 2): põe
 * `reveal-ready` na raiz só se há IntersectionObserver e não há preferência
 * por movimento reduzido; retira a classe aos 4 s se o código principal
 * (LandingRoot) não tiver se registrado, para o conteúdo nunca ficar preso.
 */
const SCRIPT = `(()=>{const r=document.documentElement;if(!('IntersectionObserver'in window)||matchMedia('(prefers-reduced-motion: reduce)').matches)return;r.classList.add('reveal-ready');setTimeout(()=>{if(!window.plinaReveal)r.classList.remove('reveal-ready');},4000);})();`;

export function RevealHeadScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
