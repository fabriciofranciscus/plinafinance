'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLocale } from '@/app/actions/set-locale';
import type { Locale } from '@/lib/i18n/types';

/** Seletor PT/EN da página de privacidade (mesma ação do seletor da landing). */
export function LangSwitch({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();
  const [, start] = useTransition();
  const go = (next: Locale) => {
    if (next === locale) return;
    start(async () => {
      await setLocale(next);
      router.refresh();
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
