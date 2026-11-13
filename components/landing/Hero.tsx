import type { LandingV2 } from '@/lib/i18n/types';
import { Icon } from './icons';
import { Lines } from './Lines';
import { MotionToggle } from './MotionToggle';
import { RibbonCanvas } from './RibbonCanvas';

/** Hero + faixa de estágio (SPEC §1, blocos 2 e 3). */
export function Hero({ dict }: { dict: LandingV2 }) {
  const h = dict.hero;
  return (
    <div className="wrap">
      <section className="hero-stage" aria-labelledby="hero-title">
        <div className="hero-content">
          <p className="hero-kicker">{h.kicker}</p>
          <h1 id="hero-title">
            <Lines lines={h.titulo} />
          </h1>
          <p className="hero-description">{h.sub}</p>
          <div className="hero-actions">
            <a className="btn" href="#contato" data-interest="tese">
              {h.ctaFalar} <Icon name="arrow-up-right" />
            </a>
            <a className="sub-action" href="#mercado">
              {h.ctaEstrutura} <Icon name="arrow-down" />
            </a>
          </div>
        </div>
        <div className="ribbon-scene" aria-hidden="true">
          <RibbonCanvas />
          {/* Sem JavaScript: pôster da fita em repouso (AVIF com WebP de reserva). */}
          <noscript>
            <picture>
              <source type="image/avif" srcSet="/landing/ribbon-poster.avif" />
              <img src="/landing/ribbon-poster.webp" alt="" width={1142} height={980} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </picture>
          </noscript>
        </div>
        <div className="hero-baseline">
          <span className="label">{h.marca}</span>
          <MotionToggle pauseLabel={dict.a11y.pausarMovimento} playLabel={dict.a11y.ativarMovimento} />
        </div>
      </section>
      <div className="landing-context">
        <p>
          <span className="context-label">{h.estagioRotulo}</span>
          {h.estagioValor}
        </p>
        <a href="#transparencia">
          {h.estagioLink} <Icon name="arrow-up-right" />
        </a>
      </div>
    </div>
  );
}
