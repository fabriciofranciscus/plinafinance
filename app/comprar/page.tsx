'use client';

/**
 * /comprar — landing pro comprador-usuário (Maria + variantes PJ).
 *
 * Calculadora comparativa é lead-magnet: financiamento bancário vs cota
 * contemplada com deságio. Mostra economia em R$ e em meses.
 * PRODUCT.md §5: fricção mínima, sem chrome institucional, brand visual
 * mantido.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const TIPO_LABEL: Record<string, string> = {
  IMOVEL: 'Imóvel',
  VEICULO: 'Veículo',
  EQUIPAMENTO: 'Equipamento',
  SERVICO: 'Serviços',
};

// Taxa de juros média referência mercado BR (CET anual aprox.).
const TAXA_ANUAL_BANCO: Record<string, number> = {
  IMOVEL: 0.115, // crédito imobiliário SBPE
  VEICULO: 0.27, // CDC veículo
  EQUIPAMENTO: 0.22, // CDC PJ
  SERVICO: 0.3,
};

const PRAZO_MESES: Record<string, number> = {
  IMOVEL: 240, // 20 anos
  VEICULO: 60,
  EQUIPAMENTO: 48,
  SERVICO: 36,
};

function pmtFinanciamento(valor: number, taxaAnual: number, meses: number): number {
  const i = taxaAnual / 12;
  return (valor * i) / (1 - Math.pow(1 + i, -meses));
}

export default function ComprarPage() {
  const [tipoBem, setTipoBem] = useState<keyof typeof TIPO_LABEL>('IMOVEL');
  const [valorAlvo, setValorAlvo] = useState('300000');
  const [desagioCota, setDesagioCota] = useState('0.10');

  const comparativo = useMemo(() => {
    const valor = Number(valorAlvo);
    const desagio = Number(desagioCota);
    if (!isFinite(valor) || valor <= 0) return null;

    const valorCota = Math.floor(valor * (1 - desagio));
    const economiaImediata = valor - valorCota;

    const taxa = TAXA_ANUAL_BANCO[tipoBem] ?? 0.15;
    const prazo = PRAZO_MESES[tipoBem] ?? 60;
    const parcela = pmtFinanciamento(valor, taxa, prazo);
    const totalFinanciamento = parcela * prazo;
    const economiaFinanciamento = totalFinanciamento - valorCota;

    return {
      valorAlvo: valor,
      valorCota,
      economiaImediata,
      taxa,
      prazo,
      parcela,
      totalFinanciamento,
      economiaFinanciamento,
    };
  }, [valorAlvo, desagioCota, tipoBem]);

  return (
    <div className="bg-sheet-white">
      {/* Hero */}
      <section className="px-6 py-16 md:py-24">
        <div className="mx-auto max-w-5xl">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
            Comprador · cota contemplada
          </p>
          <h1 className="font-title text-4xl md:text-6xl font-semibold tracking-tight mt-4 max-w-3xl">
            Compre o bem direto. Sem CET de banco.
          </h1>
          <p className="font-text text-lg md:text-xl text-base/80 mt-4 max-w-2xl leading-relaxed">
            Use uma cota de consórcio já contemplada com deságio. Você paga
            menos pelo bem que iria comprar de qualquer jeito, e zera juros
            de financiamento. Imóvel, veículo, equipamento — você escolhe.
          </p>

          {/* Calculadora comparativa */}
          <div className="mt-12 border border-light-hairline">
            <div className="px-6 py-4 border-b border-light-hairline bg-document-grey/50">
              <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                Quanto você economiza
              </p>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block">
                <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                  Tipo de bem
                </span>
                <select
                  value={tipoBem}
                  onChange={(e) =>
                    setTipoBem(e.target.value as keyof typeof TIPO_LABEL)
                  }
                  className="mt-2 w-full bg-white border border-light-hairline px-3 py-2.5 font-text text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {Object.keys(TIPO_LABEL).map((t) => (
                    <option key={t} value={t}>
                      {TIPO_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                  Valor do bem
                </span>
                <input
                  type="number"
                  min="10000"
                  step="10000"
                  value={valorAlvo}
                  onChange={(e) => setValorAlvo(e.target.value)}
                  className="mt-2 w-full bg-white border border-light-hairline px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </label>
              <label className="block">
                <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                  Deságio típico
                </span>
                <select
                  value={desagioCota}
                  onChange={(e) => setDesagioCota(e.target.value)}
                  className="mt-2 w-full bg-white border border-light-hairline px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="0.08">8%</option>
                  <option value="0.10">10%</option>
                  <option value="0.12">12%</option>
                  <option value="0.15">15%</option>
                </select>
              </label>
            </div>

            {comparativo && (
              <div className="border-t border-light-hairline grid grid-cols-1 md:grid-cols-2 gap-px bg-base/15">
                <div className="bg-sheet-white p-6">
                  <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                    Comprando via cota Plina
                  </p>
                  <p className="font-title text-3xl md:text-4xl font-semibold mt-2 tracking-tight">
                    {BRL.format(comparativo.valorCota)}
                  </p>
                  <p className="font-mono text-xs text-base/60 mt-2">
                    À vista · você economiza{' '}
                    {BRL.format(comparativo.economiaImediata)} do valor de
                    face.
                  </p>
                </div>
                <div className="bg-document-grey p-6">
                  <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                    Financiando no banco · CET {(comparativo.taxa * 100).toFixed(1)}% a.a.
                  </p>
                  <p className="font-title text-2xl font-semibold mt-2 tracking-tight">
                    {BRL.format(comparativo.parcela)}<span className="text-base">/mês</span>
                  </p>
                  <p className="font-mono text-xs text-base/60 mt-2">
                    {comparativo.prazo} parcelas · total{' '}
                    {BRL.format(comparativo.totalFinanciamento)}
                  </p>
                </div>

                <div className="md:col-span-2 bg-base text-lightBg p-6">
                  <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary">
                    Você poupa, ao longo do financiamento
                  </p>
                  <p className="font-title text-4xl md:text-5xl font-semibold mt-2 tracking-tight">
                    {BRL.format(comparativo.economiaFinanciamento)}
                  </p>
                  <p className="font-mono text-xs text-lightBg/70 mt-2">
                    {((comparativo.economiaFinanciamento /
                      comparativo.totalFinanciamento) *
                      100
                    ).toFixed(0)}
                    % do total que iria pagar ao banco.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link
                      href="/cotas"
                      className="bg-primary text-base font-details text-[10px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-secondaryLight transition-colors"
                    >
                      Ver cotas disponíveis →
                    </Link>
                    <Link
                      href={`/comprar/lead?tipoBem=${tipoBem}&valorAlvo=${valorAlvo}`}
                      className="border border-lightBg/30 text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-lightBg/10 transition-colors"
                    >
                      Receber alertas
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Como funciona */}
      <section className="bg-document-grey px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Como funciona
          </p>
          <h2 className="font-title text-3xl md:text-4xl font-semibold tracking-tight mt-4">
            Três passos. Transferência institucional.
          </h2>
          <ol className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-px bg-base/15 border border-light-hairline">
            <Step
              n="01"
              titulo="Escolha a cota"
              copy="Lista pública com filtros de tipo de bem, valor e prazo. Reserve por 72h enquanto avalia."
            />
            <Step
              n="02"
              titulo="Qualifique-se"
              copy="Plina valida sua capacidade e o casamento entre cota e bem-alvo. Sem score de crédito."
            />
            <Step
              n="03"
              titulo="Transferência efetivada"
              copy="Titularidade transferida na administradora. Pagamento via Pix. Hash on-chain do contrato pra auditoria pública."
            />
          </ol>
        </div>
      </section>

      {/* Trust */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Diferenças que importam
          </p>
          <h2 className="font-title text-3xl md:text-4xl font-semibold tracking-tight mt-4">
            Não é leilão. Não é grupo. É institucional.
          </h2>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-px bg-base/15 border border-light-hairline">
            <TrustBlock
              titulo="Cotas verificadas"
              copy="Adimplência, contemplação e titularidade conferidas antes de entrar no pool. Você não tem que validar com a administradora — Plina já fez."
            />
            <TrustBlock
              titulo="Preço firme, sem leilão"
              copy="O deságio aparece publicamente em /cotas. Sem negociação caótica, sem corrida contra outro comprador."
            />
            <TrustBlock
              titulo="Estrutura tokenizada na Stellar"
              copy="Cada cota é um direito creditório lastreando token PLINA-RF sob estrutura FIDC CVM 175 (Fase 1). Você compra de um pool regulado, não de pessoa física desconhecida."
            />
            <TrustBlock
              titulo="Contrato auditável"
              copy="Sua compra gera hash on-chain (Memo.hash na Stellar) com SHA-256 do contrato. Você guarda o PDF e verifica que bate."
            />
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-title text-3xl md:text-4xl font-semibold tracking-tight">
            Pronto pra ver as cotas disponíveis?
          </h2>
          <p className="font-text text-base/80 mt-4 max-w-xl mx-auto">
            Listagem pública com filtros. Reserva em 1 clique, 72h de janela.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Link
              href="/cotas"
              className="bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase px-8 py-4 hover:bg-primary-deep transition-colors"
            >
              Ver cotas disponíveis →
            </Link>
            <Link
              href="/comprar/lead"
              className="border border-base text-base font-details text-xs tracking-[0.2em] uppercase px-8 py-4 hover:bg-base hover:text-lightBg transition-colors"
            >
              Qualificar-me primeiro
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function Step({ n, titulo, copy }: { n: string; titulo: string; copy: string }) {
  return (
    <div className="bg-lightBg p-6 group relative">
      <span className="absolute top-0 left-0 w-[2px] h-full bg-primary scale-y-0 group-hover:scale-y-100 origin-top transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]" />
      <p className="font-mono text-xs text-primary-deep">{n}</p>
      <h3 className="font-title text-lg font-semibold mt-2 tracking-tight">{titulo}</h3>
      <p className="font-text text-sm text-base/70 mt-2 leading-relaxed">{copy}</p>
    </div>
  );
}

function TrustBlock({ titulo, copy }: { titulo: string; copy: string }) {
  return (
    <div className="bg-sheet-white p-6">
      <h3 className="font-title text-lg font-semibold tracking-tight">{titulo}</h3>
      <p className="font-text text-sm text-base/70 mt-2 leading-relaxed">{copy}</p>
    </div>
  );
}
