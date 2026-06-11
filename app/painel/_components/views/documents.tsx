'use client';

/**
 * Documentos — regulamento, prospecto e pareceres. Os PDFs institucionais ainda
 * não têm fonte (selo ilustrativo), mas os três últimos itens são links REAIS
 * pra superfícies auditáveis já existentes (/pool, /politica-clawback,
 * stellar.toml).
 */

import { ViewHead } from './cotas';
import { IllustrativeBanner } from './distributions';

interface DocRow {
  name: string;
  meta: string;
  tag: string;
  href?: string;
  real?: boolean;
}

const DOCS: DocRow[] = [
  {
    name: 'Regulamento do FIDC',
    meta: 'CVM 175 · versão de referência',
    tag: 'Regulatório',
  },
  {
    name: 'Prospecto PLINA-RF',
    meta: 'Oferta classe sênior e subordinada',
    tag: 'Oferta',
  },
  {
    name: 'Parecer jurídico',
    meta: 'Enquadramento sob Lei 11.795/2008',
    tag: 'Jurídico',
  },
  {
    name: 'Pool público · NAV',
    meta: 'Composição do pool e NAV diário, auditável em tempo real',
    tag: 'Dados',
    href: '/pool',
    real: true,
  },
  {
    name: 'Política de clawback',
    meta: 'Quatro hipóteses exclusivas de reversão institucional',
    tag: 'Política',
    href: '/politica-clawback',
    real: true,
  },
  {
    name: 'stellar.toml',
    meta: 'Metadados do emissor e do ativo · SEP-0001',
    tag: 'On-chain',
    href: '/.well-known/stellar.toml',
    real: true,
  },
];

export default function Documents() {
  return (
    <div>
      <ViewHead
        eyebrow="Auditabilidade"
        title="Documentos"
        lede="Regulamento, prospecto e pareceres para diligência de mesa de risco institucional. Os itens marcados levam às superfícies auditáveis já publicadas; os PDFs regulatórios são ilustrativos nesta fase."
      />

      <IllustrativeBanner text="PDFs regulatórios ilustrativos · links auditáveis reais marcados" />

      <div className="border-t border-light-hairline mt-px">
        {DOCS.map((d) => {
          const Inner = (
            <>
              <span
                className={`absolute left-0 top-0 bottom-0 w-[2px] ${
                  d.real ? 'bg-primary' : 'bg-base/15'
                }`}
              />
              <div>
                <div className="font-title text-lg font-semibold tracking-tight text-base">
                  {d.name}
                </div>
                <div className="font-text text-[13px] text-base/55 mt-1">
                  {d.meta}
                </div>
              </div>
              <span className="font-details text-[9px] font-bold tracking-[0.16em] uppercase text-primary-deep bg-white border border-light-hairline px-3 py-1.5 whitespace-nowrap">
                {d.tag}
              </span>
              <span className="font-details text-[9px] font-bold tracking-[0.16em] uppercase text-base whitespace-nowrap">
                {d.real ? 'Abrir ↗' : 'PDF ↓'}
              </span>
            </>
          );

          const cls =
            'relative grid grid-cols-[1fr_auto_auto] items-center gap-6 py-5 pl-5 border-b border-light-hairline transition-colors hover:bg-white';

          return d.href ? (
            <a
              key={d.name}
              href={d.href}
              target={d.href.startsWith('/.well-known') ? '_blank' : undefined}
              rel="noopener noreferrer"
              className={`${cls} cursor-pointer`}
            >
              {Inner}
            </a>
          ) : (
            <div
              key={d.name}
              className={`${cls} opacity-70`}
              aria-disabled
            >
              {Inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
