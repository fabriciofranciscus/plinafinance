'use client';

import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import ConsoleStrip from './ConsoleStrip';

export default function SiteHeader() {
  const [pastHero, setPastHero] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setPastHero(window.scrollY > window.innerHeight - 80);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      <div
        className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${
          pastHero ? 'max-h-0 opacity-0' : 'max-h-12 opacity-100'
        }`}
      >
        <ConsoleStrip />
      </div>

      <nav
        className={`w-full transition-colors duration-300 ease-out ${
          pastHero
            ? 'bg-base/95 backdrop-blur-md border-b border-white/10'
            : 'backdrop-blur-md'
        }`}
      >
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12 h-20 flex items-center justify-between relative">
          <div className="flex items-center gap-2">
            <a
              href="#"
              className="font-title font-semibold text-4xl tracking-wide text-lightBg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary rounded-sm"
              aria-label="Plina · Início"
            >
              Plina<span className="text-primary">.</span>
            </a>
          </div>

          <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 items-center gap-10 font-details text-[11px] text-white/80 uppercase tracking-widest">
            <a href="#produto" className="hover:text-white transition-colors">
              Produto
            </a>
            <a href="#tese" className="hover:text-white transition-colors">
              Tese
            </a>
            <a href="#compliance" className="hover:text-white transition-colors">
              Compliance
            </a>
            <a href="#equipe" className="hover:text-white transition-colors">
              Equipe
            </a>
          </div>

          <div
            className={`hidden md:block transition-[opacity,transform] duration-300 ease-out ${
              pastHero ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none -translate-y-1'
            }`}
          >
            <a
              href="#lead-capture"
              className="font-details text-[10px] uppercase tracking-widest bg-white text-base font-bold px-5 py-2.5 rounded-full hover:bg-lightBg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary transition-colors shadow-xl"
            >
              Solicitar Prospecto
            </a>
          </div>

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="lg:hidden text-white p-3 -mr-3 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuOpen}
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>

        {menuOpen && (
          <div className="lg:hidden bg-base border-t border-white/10 px-6 py-6 flex flex-col gap-6 font-details text-sm text-white/80 uppercase tracking-widest">
            <a href="#produto" onClick={() => setMenuOpen(false)}>
              Produto
            </a>
            <a href="#tese" onClick={() => setMenuOpen(false)}>
              Tese
            </a>
            <a href="#compliance" onClick={() => setMenuOpen(false)}>
              Compliance
            </a>
            <a href="#equipe" onClick={() => setMenuOpen(false)}>
              Equipe
            </a>
            <a
              href="#lead-capture"
              onClick={() => setMenuOpen(false)}
              className="text-primary font-bold"
            >
              Solicitar Prospecto
            </a>
          </div>
        )}
      </nav>
    </div>
  );
}
