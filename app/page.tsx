import SiteHeader from '@/components/SiteHeader';
import HeroSection from '@/components/HeroSection';
import ProdutoSection from '@/components/ProdutoSection';
import TeseSection from '@/components/TeseSection';
import BigStatementSection from '@/components/BigStatementSection';
import ComplianceSection from '@/components/ComplianceSection';
import EquipeSection from '@/components/EquipeSection';
import LeadCaptureSection from '@/components/LeadCaptureSection';
import Footer from '@/components/Footer';
import ConsoleFooter from '@/components/ConsoleFooter';
import RevealInit from '@/components/RevealInit';
import { getDictionary } from '@/lib/i18n/get-locale';

export default async function Home() {
  const { locale, dict } = await getDictionary();

  return (
    <>
      <RevealInit />
      <SiteHeader dict={dict.siteHeader} consoleStrip={dict.consoleStrip} locale={locale} />
      <HeroSection dict={dict.hero} />
      <ProdutoSection dict={dict.produto} />
      <TeseSection dict={dict.tese} />
      <BigStatementSection dict={dict.bigStatement} />
      <ComplianceSection dict={dict.compliance} />
      <EquipeSection dict={dict.equipe} />
      <LeadCaptureSection dict={dict.leadCapture} />
      <Footer dict={dict.footer} />
      <ConsoleFooter dict={dict.consoleFooter} />
    </>
  );
}
