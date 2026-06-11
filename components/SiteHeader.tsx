'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Menu } from 'lucide-react';
import ConsoleStrip from './ConsoleStrip';
import { usePessoa } from './PessoaProvider';
import { useAppLogout } from '@/lib/hooks/privy';

// Header da landing (/) navega pelas seções da própria página; os botões de
// login/painel (abaixo) é que levam pras superfícies do app.
const navLinks = [
  { label: 'Produto', href: '#produto', route: false },
  { label: 'Tese', href: '#tese', route: false },
  { label: 'Compliance', href: '#compliance', route: false },
  { label: 'Equipe', href: '#equipe', route: false },
] as const;

export default function SiteHeader() {
  const [pastHero, setPastHero] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pessoa = usePessoa();
  const { logout } = useAppLogout();

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

          <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 items-center gap-7 font-details text-[11px] text-white/80 uppercase tracking-widest">
            {navLinks.map((l) =>
              l.route ? (
                <Link
                  key={l.href}
                  href={l.href}
                  className="hover:text-white transition-colors whitespace-nowrap"
                >
                  {l.label}
                </Link>
              ) : (
                <a
                  key={l.href}
                  href={l.href}
                  className="hover:text-white transition-colors whitespace-nowrap"
                >
                  {l.label}
                </a>
              )
            )}
          </div>

          <div className="hidden md:flex items-center gap-5">
            {pessoa.authenticated ? (
              <>
                <Link
                  href="/painel"
                  className="font-details text-[10px] uppercase tracking-widest text-white/85 hover:text-white transition-colors whitespace-nowrap"
                >
                  Painel
                </Link>
                <button
                  onClick={() => logout()}
                  className="font-details text-[10px] uppercase tracking-widest text-white/55 hover:text-white transition-colors whitespace-nowrap"
                >
                  Sair
                </button>
              </>
            ) : (
              <Link
                href="/entrar"
                className="font-details text-[10px] uppercase tracking-widest text-white/85 hover:text-white transition-colors whitespace-nowrap"
              >
                Entrar
              </Link>
            )}
            <a
              href="#lead-capture"
              className={`font-details text-[10px] uppercase tracking-widest bg-white text-base font-bold px-5 py-2.5 rounded-full hover:bg-lightBg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary transition-colors shadow-xl ${
                pastHero ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none -translate-y-1'
              } transition-[opacity,transform] duration-300 ease-out`}
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
            {navLinks.map((l) =>
              l.route ? (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                >
                  {l.label}
                </Link>
              ) : (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                >
                  {l.label}
                </a>
              )
            )}
            {pessoa.authenticated ? (
              <>
                <Link href="/painel" onClick={() => setMenuOpen(false)}>
                  Painel
                </Link>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    void logout();
                  }}
                  className="text-left text-white/60"
                >
                  Sair
                </button>
              </>
            ) : (
              <Link href="/entrar" onClick={() => setMenuOpen(false)}>
                Entrar
              </Link>
            )}
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
