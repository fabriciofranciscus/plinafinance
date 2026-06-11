'use client';

/**
 * Minhas Cotas — tabela por classe (Sênior PLINARF + Subordinada PLINARFB) com
 * cotas, NAV/cota, valor e participação, fechando no total. Valores reais
 * (saldo Horizon × navUnit). Card "Duration média" é ilustrativo (sem fonte).
 */

import { BRL, NUMBER_INT, explorerAsset } from '../../_lib/format';
import type { PainelData } from '../../_hooks/use-painel-data';

export default function Cotas({ data }: { data: PainelData }) {
  const { seniorQty, subordinadaQty, plinarfQty, navUnit, pool } = data;

  const rows = [
    {
      classe: 'Classe Sênior',
      swatch: '#132728',
      qty: seniorQty,
      perfil: 'Prioridade no recebimento',
    },
    {
      classe: 'Classe Subordinada',
      swatch: '#057A99',
      qty: subordinadaQty,
      perfil: 'Absorve perdas primeiro',
    },
  ];
  const totalValor = plinarfQty * navUnit;

  return (
    <div>
      <ViewHead
        eyebrow="Carteira PLINA-RF"
        title="Minhas cotas"
        lede="Cada cota representa R$ 1,00 em direito creditório na emissão, ajustado diariamente pelo NAV. As classes absorvem perdas em ordem de subordinação."
      />

      {plinarfQty <= 0 ? (
        <div className="border-t border-light-hairline pt-8">
          <p className="font-text text-[15px] text-base/70 leading-relaxed max-w-[60ch]">
            Você ainda não detém cotas. Ao alocar capital no pool, sua posição
            aparece aqui dividida entre a classe Sênior (prioridade no
            recebimento) e a Subordinada (absorve perdas primeiro).
          </p>
          <a
            href="/investir"
            className="mt-5 inline-block bg-base text-lightBg font-details text-[10px] font-bold tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-lightBg"
          >
            Acessar oferta →
          </a>
        </div>
      ) : (
        <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-light-hairline">
          <thead>
            <tr className="bg-white">
              <Th>Classe</Th>
              <Th right>Cotas</Th>
              <Th right>NAV / cota</Th>
              <Th right>Valor</Th>
              <Th right>Participação</Th>
              <Th>Perfil</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const part =
                plinarfQty > 0 ? (r.qty / plinarfQty) * 100 : 0;
              return (
                <tr
                  key={r.classe}
                  className="border-t border-light-hairline bg-lightBg hover:bg-white transition-colors"
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span
                        className="w-2.5 h-2.5 flex-shrink-0"
                        style={{ background: r.swatch }}
                      />
                      <span className="font-text text-sm text-base">
                        {r.classe}
                      </span>
                    </div>
                  </td>
                  <Td right mono>
                    {NUMBER_INT.format(r.qty)}
                  </Td>
                  <Td right mono muted>
                    {BRL.format(navUnit)}
                  </Td>
                  <Td right mono>
                    {BRL.format(r.qty * navUnit)}
                  </Td>
                  <Td right mono>
                    {part.toFixed(1)}%
                  </Td>
                  <td className="px-5 py-4 font-text text-[13px] text-base/60">
                    {r.perfil}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-base/30 bg-base text-lightBg">
              <td className="px-5 py-4 font-details text-[10px] font-bold tracking-[0.18em] uppercase text-secondaryLight">
                Total
              </td>
              <td className="px-5 py-4 text-right font-mono text-sm text-white">
                {NUMBER_INT.format(plinarfQty)}
              </td>
              <td className="px-5 py-4" />
              <td className="px-5 py-4 text-right font-mono text-sm text-white">
                {BRL.format(totalValor)}
              </td>
              <td className="px-5 py-4 text-right font-mono text-sm text-white">
                100%
              </td>
              <td className="px-5 py-4" />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-base/15 border border-light-hairline border-t-0 mt-px">
        <StatCard
          label="Lastro"
          value="1 RF = R$ 1,00"
          note="Em direito creditório, ajustado diariamente pelo NAV."
        />
        <StatCard
          label="Duration média"
          value="—"
          note="Prazo médio ponderado do pool. Indicador ilustrativo nesta fase."
          illustrative
        />
        <StatCard
          label="Ativo on-chain"
          value="PLINA-RF"
          note={pool?.issuerPubkey ? `${pool.issuerPubkey.slice(0, 4)}…${pool.issuerPubkey.slice(-4)}` : undefined}
          href={
            pool?.issuerPubkey
              ? explorerAsset('PLINARF', pool.issuerPubkey)
              : undefined
          }
        />
      </div>
        </>
      )}
    </div>
  );
}

export function ViewHead({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede: string;
}) {
  return (
    <div className="mb-8">
      <p className="font-details text-[10px] font-bold tracking-[0.24em] uppercase text-primary-deep">
        {eyebrow}
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold tracking-tight text-base mt-3">
        {title}
      </h1>
      <p className="font-text text-[15px] text-base/60 leading-relaxed max-w-[66ch] mt-2.5">
        {lede}
      </p>
    </div>
  );
}

function Th({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
  return (
    <th
      className={`font-details text-[9px] font-bold tracking-[0.18em] uppercase text-base/55 px-5 py-3.5 ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  mono,
  muted,
}: {
  children: React.ReactNode;
  right?: boolean;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`px-5 py-4 ${right ? 'text-right' : ''} ${
        mono ? 'font-mono text-sm' : 'font-text text-sm'
      } ${muted ? 'text-base/70' : 'text-base'}`}
    >
      {children}
    </td>
  );
}

function StatCard({
  label,
  value,
  note,
  href,
  illustrative,
}: {
  label: string;
  value: string;
  note?: string;
  href?: string;
  illustrative?: boolean;
}) {
  return (
    <div className="bg-lightBg px-6 py-6">
      <div className="flex items-center gap-2">
        <p className="font-details text-[9px] font-bold tracking-[0.2em] uppercase text-base/50">
          {label}
        </p>
        {illustrative && (
          <span className="font-details text-[8px] font-bold tracking-[0.14em] uppercase text-base/40 border border-base/20 px-1.5 py-0.5">
            ilustrativo
          </span>
        )}
      </div>
      <p className="font-mono text-xl text-base mt-3.5">{value}</p>
      {note &&
        (href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] text-primary-deep hover:text-primary mt-2 inline-block"
          >
            {note} ↗
          </a>
        ) : (
          <p className="font-text text-xs text-base/55 mt-2 leading-relaxed">
            {note}
          </p>
        ))}
    </div>
  );
}
