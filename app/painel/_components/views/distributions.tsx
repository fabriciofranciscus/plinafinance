'use client';

/**
 * Distribuições — rendimentos mensais. NÃO há backend de distribuição em
 * testnet, então os números são ILUSTRATIVOS (selo explícito). Quando houver
 * agregação real (RealizacaoCaminho por mês), trocar a fonte aqui.
 */

import { ViewHead } from './cotas';

const BARS = [
  { mes: 'JAN', valor: '88,2k', h: 60, on: false },
  { mes: 'FEV', valor: '91,5k', h: 66, on: false },
  { mes: 'MAR', valor: '94,8k', h: 73, on: false },
  { mes: 'ABR', valor: '96,1k', h: 78, on: false },
  { mes: 'MAI', valor: '98,7k', h: 88, on: false },
  { mes: 'JUN', valor: '104,2k', h: 100, on: true },
];

const ROWS = [
  { month: 'Junho 2026', date: '11 JUN 2026', value: 'R$ 104.200', yield: '1,24%' },
  { month: 'Maio 2026', date: '28 MAI 2026', value: 'R$ 98.700', yield: '1,18%' },
  { month: 'Abril 2026', date: '29 ABR 2026', value: 'R$ 96.100', yield: '1,15%' },
  { month: 'Março 2026', date: '28 MAR 2026', value: 'R$ 94.800', yield: '1,13%' },
  { month: 'Fevereiro 2026', date: '27 FEV 2026', value: 'R$ 91.500', yield: '1,09%' },
  { month: 'Janeiro 2026', date: '30 JAN 2026', value: 'R$ 88.200', yield: '1,05%' },
];

export default function Distributions() {
  return (
    <div>
      <ViewHead
        eyebrow="Rendimentos"
        title="Distribuições"
        lede="Distribuições mensais creditadas em BRL, líquidas de taxa de gestão e performance. Os valores abaixo são ilustrativos — não há distribuição real em ambiente de testnet."
      />

      <IllustrativeBanner text="Dados ilustrativos · sem distribuição em testnet" />

      <div className="border border-light-hairline bg-lightBg px-7 py-7 mt-px">
        <div className="font-details text-[9px] font-bold tracking-[0.2em] uppercase text-base/50 mb-6">
          Distribuído por mês · R$
        </div>
        <div className="flex items-end gap-4 h-44">
          {BARS.map((b) => (
            <div
              key={b.mes}
              className="flex-1 flex flex-col items-center gap-2.5 h-full justify-end"
            >
              <span
                className={`font-mono text-[11px] ${b.on ? 'text-primary-deep' : 'text-base/60'}`}
              >
                {b.valor}
              </span>
              <div
                className={`w-full ${b.on ? 'bg-primary' : 'bg-base'}`}
                style={{ height: `${b.h}%` }}
              />
              <span
                className={`font-details text-[9px] font-bold tracking-[0.14em] ${b.on ? 'text-primary-deep' : 'text-base/45'}`}
              >
                {b.mes}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-light-hairline border-t-0">
          <thead>
            <tr className="bg-white">
              <Th>Competência</Th>
              <Th>Crédito</Th>
              <Th right>Valor distribuído</Th>
              <Th right>Yield no mês</Th>
              <Th right>Status</Th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((d) => (
              <tr
                key={d.month}
                className="border-t border-light-hairline bg-lightBg hover:bg-white transition-colors"
              >
                <td className="px-5 py-3.5 font-text text-sm text-base">
                  {d.month}
                </td>
                <td className="px-5 py-3.5 font-mono text-[11px] text-base/60">
                  {d.date}
                </td>
                <td className="px-5 py-3.5 text-right font-mono text-sm text-base">
                  {d.value}
                </td>
                <td className="px-5 py-3.5 text-right font-mono text-sm text-base/70">
                  {d.yield}
                </td>
                <td className="px-5 py-3.5 text-right font-details text-[9px] font-bold tracking-[0.14em] uppercase text-base/45">
                  Ilustrativo
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function IllustrativeBanner({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3 bg-base/[0.04] border border-light-hairline">
      <span className="w-1.5 h-1.5 rounded-full bg-base/40" />
      <span className="font-details text-[10px] font-bold tracking-[0.16em] uppercase text-base/55">
        {text}
      </span>
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
