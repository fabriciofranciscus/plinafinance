'use client';

import { useTransition } from 'react';
import { setLocale } from '@/app/actions/set-locale';
import type { Locale } from '@/lib/i18n/types';

/** Seletor PT/EN da página de privacidade (mesma ação do seletor da landing). */
export function LangSwitch({ locale, label }: { locale: Locale; label: string }) {
  const [, start] = useTransition();
  const go = (next: Locale) => {
    if (next === locale) return;
    start(async () => {
      await setLocale(next);
      // Recarrega em vez de router.refresh(): o React não atualiza o conteúdo de <noscript> no cliente,
      // e a nota sem JavaScript ficaria no idioma anterior (Íris LV7).
      window.location.reload();
    });
  };
  return (
    <div className="lang" role="group" aria-label={label}>
      <button type="button" lang="pt-BR" aria-current={locale === 'pt-BR'} onClick={() => go('pt-BR')}>
        PT
      </button>
      <span aria-hidden="true">/</span>
      <button type="button" lang="en" aria-current={locale === 'en'} onClick={() => go('en')}>
        EN
      </button>
    </div>
  );
}
