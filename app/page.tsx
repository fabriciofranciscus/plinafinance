import { RevealHeadScript } from '@/components/landing/RevealHeadScript';
import { LandingRoot } from '@/components/landing/LandingRoot';
import { TopBar } from '@/components/landing/TopBar';
import { Hero } from '@/components/landing/Hero';
import {
  AssetSection,
  AudienceSection,
  ProcessSection,
  StageSection,
} from '@/components/landing/Sections';
import { ContactSection } from '@/components/landing/ContactSection';
import { LandingFooter } from '@/components/landing/LandingFooter';
import '@/components/landing/landing.css';
import { accountExplorerUrl } from '@/lib/stellar/config';
import { getDictionary } from '@/lib/i18n/get-locale';

export default async function Home() {
  const { locale, dict } = await getDictionary();
  const t = dict.landingV2;
  // Link da rede de testes: navegação (nova aba), não recurso. Sem conta configurada, sai.
  const issuer = process.env.STELLAR_ISSUER_PUBLIC;
  const ledgerUrl = issuer ? accountExplorerUrl(issuer) : null;

  return (
    <LandingRoot>
      <RevealHeadScript />
      <noscript>
        {/* Sem JavaScript o menu não abre: a navegação fica sempre visível. */}
        <style>{`.ld .menu-toggle{display:none!important}.ld .topbar-nav{display:flex!important}`}</style>
      </noscript>
      <a className="skip" href="#conteudo">
        {t.a11y.pular}
      </a>
      <TopBar dict={t} locale={locale} />
      <main id="conteudo">
        <Hero dict={t} />
        <AssetSection dict={t} />
        <ProcessSection dict={t} />
        <StageSection dict={t} />
        <AudienceSection dict={t} />
        <ContactSection dict={t} />
      </main>
      <LandingFooter dict={t} ledgerUrl={ledgerUrl} />
    </LandingRoot>
  );
}
