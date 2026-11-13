import type { LandingV2 } from '@/lib/i18n/types';
import { Icon } from './icons';

/** Rodapé (SPEC §1, bloco 9). `ledgerUrl` vem de accountExplorerUrl (lib/stellar/config). */
export function LandingFooter({ dict, ledgerUrl }: { dict: LandingV2; ledgerUrl: string | null }) {
  const f = dict.footer;
  return (
    <footer className="footer dark">
      <div className="wrap">
        <div className="footer-top">
          <div>
            <a className="footer-logo" href="#conteudo" aria-label={dict.a11y.voltarInicio}>
              Plina<span>.</span>
            </a>
            <p className="tagline">
              {f.tagline.map((linha) => (
                <span key={linha}>{linha}</span>
              ))}
            </p>
          </div>
          <div className="footer-links">
            <div>
              <span className="label">{f.conheca}</span>
              <a href="#mercado">{dict.nav.ativo}</a>
              <a href="#operacao">{dict.nav.percurso}</a>
              <a href="#para-quem">{dict.nav.paraQuem}</a>
            </div>
            <div>
              <span className="label">{f.converse}</span>
              <a href="#transparencia">{f.transparencia}</a>
              <a href="#contato">{dict.nav.falar}</a>
              <a href={`mailto:${dict.contato.email}`}>{dict.contato.email}</a>
              <a href="/privacidade">{f.privacidade}</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            {f.copyright.map((linha) => (
              <span key={linha}>{linha}</span>
            ))}
            {ledgerUrl ? (
              <a className="ledger-link" href={ledgerUrl} target="_blank" rel="noopener">
                {f.linkTestnet} <Icon name="arrow-up-right" />
              </a>
            ) : null}
          </span>
          <p>{f.aviso}</p>
        </div>
      </div>
    </footer>
  );
}
