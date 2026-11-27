import { accountExplorerUrl, assetExplorerUrl } from '@/lib/stellar/explorer';
/**
 * AppFooter — chrome compartilhado das superfícies do app.
 *
 * Server Component (estático). bg-deep-petrol com hairlines internas
 * tinted pra branco. Geist Mono pra refs técnicas (issuer pubkey,
 * stellar.toml path).
 */

/**
 * `completo`: o rodapé de sempre (apresentação + Auditável + Status).
 * `compacto`: faixa única para o fluxo do usuário (/vender, /comprar), que não tinha rodapé.
 * `operacao`: faixa única para o /admin, só com o que o operador confere (rede, issuer, provas).
 * As variantes novas só reaproveitam os textos do completo: nada de copy nova.
 */
export type VarianteFooter = 'completo' | 'compacto' | 'operacao';

interface AppFooterProps {
  issuerPubkey: string;
  variante?: VarianteFooter;
  /** /admin: mesma largura e gutter do painel (1440 + gutter fluido), para a borda esquerda alinhar. */
  operacional?: boolean;
}

const contorno = (operacional: boolean) =>
  operacional ? 'max-w-[var(--workspace-max)] px-[var(--spacing-gutter-ui)]' : 'max-w-6xl px-6';

const MOBILE_ALVOS = 'max-md:[&_a]:inline-flex max-md:[&_a]:min-h-[44px] max-md:[&_a]:items-center';
const ROTULO = 'font-details text-[10px] tracking-[0.2em] uppercase text-lightBg/70';
const LINK = 'text-lightBg/85 hover:text-primary transition-colors';

function Marca() {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {/* `text-base` é a COR de fundo do rodapé; a marca usa o token claro explicitamente. */}
      <p className="font-title text-lg font-semibold tracking-tight text-lightBg">
        Plina<span className="text-primary">.</span>
      </p>
      <span className={ROTULO}>© 2026 Plina Finance</span>
    </div>
  );
}

function AvisoTestnet() {
  return (
    <span className="font-details text-[10px] tracking-[0.2em] uppercase bg-lightBg/10 text-lightBg/80 px-2 py-1 inline-block">
      Ambiente de testnet · tokens sem valor real
    </span>
  );
}

function LinhaLegal({ operacional = false }: { operacional?: boolean }) {
  return (
    <div className="border-t border-lightBg/10">
      <div className={`mx-auto ${contorno(operacional)} py-3 ${ROTULO}`}>Testnet · sem oferta pública (Lei 11.795/2008)</div>
    </div>
  );
}

function FooterCompacto() {
  return (
    <footer data-variante="compacto" className={`bg-base text-lightBg ${MOBILE_ALVOS}`}>
      <div className="mx-auto max-w-6xl px-6 py-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <Marca />
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-text">
          <li><a href="/pool" className={LINK}>Pool de demonstração · NAV</a></li>
          <li><a href="/politica-clawback" className={LINK}>Política de clawback</a></li>
          <li>
            <a href="mailto:contato@plina.finance" className="font-mono text-xs text-lightBg/80 hover:text-primary">
              contato@plina.finance
            </a>
          </li>
        </ul>
        <AvisoTestnet />
      </div>
      <LinhaLegal />
    </footer>
  );
}

function FooterOperacao({ issuerPubkey, operacional }: { issuerPubkey: string; operacional: boolean }) {
  return (
    <footer data-variante="operacao" className={`bg-base text-lightBg mt-12 ${MOBILE_ALVOS}`}>
      <div className={`mx-auto ${contorno(operacional)} py-5 flex flex-col gap-5 md:flex-row md:flex-wrap md:items-center md:justify-between`}>
        <Marca />
        <dl className="flex flex-wrap gap-x-8 gap-y-3 text-xs">
          <div>
            <dt className={ROTULO}>Rede</dt>
            <dd className="font-mono text-lightBg/85">Stellar Testnet</dd>
          </div>
          <div>
            <dt className={ROTULO}>Issuer</dt>
            <dd>
              <a
                href={accountExplorerUrl(issuerPubkey)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-lightBg/85 hover:text-primary break-all"
              >
                {issuerPubkey.slice(0, 8)}…{issuerPubkey.slice(-6)}
              </a>
            </dd>
          </div>
        </dl>
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-text">
          <li>
            <a href="/.well-known/stellar.toml" className="font-mono text-xs text-lightBg/85 hover:text-primary transition-colors">
              .well-known/stellar.toml
            </a>
          </li>
          <li>
            <a
              href={assetExplorerUrl(issuerPubkey)}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK}
            >
              Stellar Expert · PLINA-RF →
            </a>
          </li>
          <li><a href="/politica-clawback" className={LINK}>Política de clawback</a></li>
        </ul>
        <AvisoTestnet />
      </div>
      <LinhaLegal operacional={operacional} />
    </footer>
  );
}

export function AppFooter({ issuerPubkey, variante = 'completo', operacional = false }: AppFooterProps) {
  if (variante === 'compacto') return <FooterCompacto />;
  if (variante === 'operacao') return <FooterOperacao issuerPubkey={issuerPubkey} operacional={operacional} />;
  return (
    <footer data-variante="completo" className={`bg-base text-lightBg mt-16 ${MOBILE_ALVOS}`}>
      <div className={`mx-auto ${contorno(operacional)} py-10 grid grid-cols-1 md:grid-cols-3 gap-8 text-sm font-text`}>
        <div>
          {/* `text-base` é a COR de fundo do rodapé (--color-base) e também tamanho: a marca ficava invisível. */}
          <p className="font-title text-lg font-semibold tracking-tight text-lightBg">
            Plina<span className="text-primary">.</span>
          </p>
          <p className="mt-3 text-lightBg/70 leading-relaxed">
            Cotas contempladas de consórcio, com registro verificável na
            Stellar testnet. Em desenvolvimento; sem oferta.
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
                Pool de demonstração · NAV
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
                href={assetExplorerUrl(issuerPubkey)}
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
                href={accountExplorerUrl(issuerPubkey)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-lightBg/85 hover:text-primary break-all"
              >
                {issuerPubkey.slice(0, 8)}…{issuerPubkey.slice(-6)}
              </a>
            </li>
            <li className="pt-2">
              <span className="font-details text-[10px] tracking-[0.2em] uppercase bg-lightBg/10 text-lightBg/80 px-2 py-1 inline-block">
                Ambiente de testnet · tokens sem valor real
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-lightBg/10">
        <div className={`mx-auto ${contorno(operacional)} py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 font-details text-[10px] tracking-[0.2em] uppercase text-lightBg/50`}>
          <span>© 2026 Plina Finance</span>
          <span>Testnet · sem oferta pública (Lei 11.795/2008)</span>
        </div>
      </div>
    </footer>
  );
}
