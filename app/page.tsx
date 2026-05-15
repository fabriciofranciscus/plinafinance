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

export default function Home() {
  return (
    <>
      <RevealInit />
      <SiteHeader />
      <HeroSection />
      <ProdutoSection />
      <TeseSection />
      <BigStatementSection />
      <ComplianceSection />
      <EquipeSection />
      <LeadCaptureSection />
      <Footer />
      <ConsoleFooter />
    </>
  );
}
