/**
 * AppFooter — chrome compartilhado das superfícies do app.
 *
 * Server Component (estático). bg-deep-petrol com hairlines internas
 * tinted pra branco. Geist Mono pra refs técnicas (issuer pubkey,
 * stellar.toml path).
 */

interface AppFooterProps {
  issuerPubkey: string;
}

const STELLAR_EXPERT_TESTNET = 'https://stellar.expert/explorer/testnet';

export function AppFooter({ issuerPubkey }: AppFooterProps) {
  return (
    <footer className="bg-base text-lightBg mt-16">
      <div className="mx-auto max-w-6xl px-6 py-10 grid grid-cols-1 md:grid-cols-3 gap-8 text-sm font-text">
        <div>
          <p className="font-title text-base font-semibold tracking-tight">
            Plina<span className="text-primary">.</span>
          </p>
          <p className="mt-3 text-lightBg/70 leading-relaxed">
            Tokenizadora institucional de direito creditório brasileiro.
            FIDC sob CVM 175. Stellar nativo.
          </p>
          <a
            href="mailto:contato@plina.finance"
            className="mt-3 inline-block font-mono text-xs text-lightBg/80 hover:text-primary"
          >
            contato@plina.finance
          </a>
        </div>

        <div>
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-lightBg/50 mb-3">
            Auditável
          </p>
          <ul className="space-y-2">
            <li>
              <a
                href="/pool"
                className="text-lightBg/85 hover:text-primary transition-colors"
              >
                Pool público · NAV
              </a>
            </li>
            <li>
              <a
                href="/politica-clawback"
                className="text-lightBg/85 hover:text-primary transition-colors"
              >
                Política de clawback
              </a>
            </li>
            <li>
              <a
                href="/.well-known/stellar.toml"
                className="font-mono text-xs text-lightBg/85 hover:text-primary transition-colors"
              >
                .well-known/stellar.toml
              </a>
            </li>
            <li>
              <a
                href={`${STELLAR_EXPERT_TESTNET}/asset/PLINARF-${issuerPubkey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-lightBg/85 hover:text-primary transition-colors"
              >
                Stellar Expert · PLINA-RF →
              </a>
            </li>
          </ul>
        </div>

        <div>
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-lightBg/50 mb-3">
            Status
          </p>
          <ul className="space-y-2 text-xs">
            <li>
              <span className="font-details text-[10px] tracking-[0.2em] uppercase text-lightBg/60">
                Rede
              </span>
              <br />
              <span className="font-mono text-lightBg/85">Stellar Testnet</span>
            </li>
            <li>
              <span className="font-details text-[10px] tracking-[0.2em] uppercase text-lightBg/60">
                Issuer
              </span>
              <br />
              <a
                href={`${STELLAR_EXPERT_TESTNET}/account/${issuerPubkey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-lightBg/85 hover:text-primary break-all"
              >
                {issuerPubkey.slice(0, 8)}…{issuerPubkey.slice(-6)}
              </a>
            </li>
            <li className="pt-2">
              <span className="font-details text-[10px] tracking-[0.2em] uppercase bg-lightBg/10 text-lightBg/80 px-2 py-1 inline-block">
                POC · não negociável
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-lightBg/10">
        <div className="mx-auto max-w-6xl px-6 py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 font-details text-[10px] tracking-[0.2em] uppercase text-lightBg/50">
          <span>© 2026 Plina Finance</span>
          <span>Versão POC · sem oferta pública (Lei 11.795/2008)</span>
        </div>
      </div>
    </footer>
  );
}
