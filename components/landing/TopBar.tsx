'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setLocale } from '@/app/actions/set-locale';
import type { LandingV2, Locale } from '@/lib/i18n/types';
import { Icon } from './icons';

type Props = { dict: LandingV2; locale: Locale };

/**
 * Barra superior (SPEC §1, §4 e menu do celular). O seletor PT/EN não está na
 * spec: o Atlas pediu para mantê-lo; fica na navegação, no mesmo estilo dos links.
 */
export function TopBar({ dict, locale }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const media = matchMedia('(max-width: 760px)');
    const onMedia = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    media.addEventListener('change', onMedia);
    return () => {
      document.removeEventListener('keydown', onKey);
      media.removeEventListener('change', onMedia);
    };
  }, [open]);

  function switchLocale(next: Locale) {
    if (next === locale) return;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  const close = () => setOpen(false);

  return (
    <header className="wrap topbar">
      <a className="brand" href="#conteudo" aria-label={dict.a11y.inicio}>
        Plina<span>.</span>
      </a>
      <button
        ref={buttonRef}
        className="menu-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="navigation"
        onClick={() => setOpen((o) => !o)}
      >
        {dict.a11y.menu} <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      <nav
        className={`topbar-nav${open ? ' open' : ''}`}
        id="navigation"
        aria-label={dict.a11y.navPrincipal}
      >
        <a href="#mercado" onClick={close}>
          {dict.nav.ativo}
        </a>
        <a href="#operacao" onClick={close}>
          {dict.nav.percurso}
        </a>
        <a href="#transparencia" onClick={close}>
          {dict.nav.estagio}
        </a>
        <a href="#para-quem" onClick={close}>
          {dict.nav.paraQuem}
        </a>
        <a href="#contato" className="contact" onClick={close}>
          {dict.nav.falar} <Icon name="arrow-up-right" />
        </a>
        <div className="lang" role="group" aria-label={dict.a11y.idioma}>
          <button type="button" lang="pt-BR" aria-current={locale === 'pt-BR'} onClick={() => switchLocale('pt-BR')}>
            {dict.languageSwitcher.pt}
          </button>
          <span aria-hidden="true">/</span>
          <button type="button" lang="en" aria-current={locale === 'en'} onClick={() => switchLocale('en')}>
            {dict.languageSwitcher.en}
          </button>
        </div>
      </nav>
    </header>
  );
}
