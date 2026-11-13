import type { LandingV2 } from '@/lib/i18n/types';
import { ContactForm } from './ContactForm';
import { Icon } from './icons';
import { Lines } from './Lines';

/** 05 Contato (fundo escuro). O formulário segue `mailto` até o LD4. */
export function ContactSection({ dict }: { dict: LandingV2 }) {
  const c = dict.contato;
  return (
    <section className="contact chapter dark" id="contato" aria-labelledby="contact-title">
      <div className="wrap contact-grid">
        <div className="contact-intro">
          <p className="contact-mark" data-r="rise">
            {c.numero}
          </p>
          <h2 id="contact-title" data-r="lines">
            <Lines lines={c.titulo} />
          </h2>
          <p className="intro-copy" data-r="rise">
            {c.intro}
          </p>
          <a className="email-link" href={`mailto:${c.email}`} data-r="rise">
            {c.email} <Icon name="arrow-up-right" />
          </a>
          <p className="contact-note" data-r="rise">
            {c.aviso}
          </p>
        </div>
        <ContactForm dict={c} />
        <noscript>
          <p className="noscript-note">{c.semJs}</p>
        </noscript>
      </div>
    </section>
  );
}
