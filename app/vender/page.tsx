'use client';

/**
 * /vender — landing pro vendedor (Ricardo).
 *
 * PRODUCT.md princípio 5: "fricção assimétrica entre superfícies". A landing
 * institucional (/) é alta fricção. Esta é o oposto: copy direto, simulador
 * inline, fricção mínima. Brand visual permanece (mesma palette, mesmo type
 * stack) — só o tom muda.
 *
 * Hero é o simulador. Lead capture acontece depois do número aparecer.
 */

import { useState } from 'react';
import Link from 'next/link';

type TipoBem = 'IMOVEL' | 'VEICULO' | 'EQUIPAMENTO' | 'SERVICO';

interface Faixa {
  desagioMinimo: number;
  desagioMaximo: number;
  valorLiquidoMinimo: number;
  valorLiquidoMaximo: number;
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const TIPO_BEM_LABEL: Record<TipoBem, string> = {
  IMOVEL: 'Imóvel',
  VEICULO: 'Veículo',
  EQUIPAMENTO: 'Equipamento',
  SERVICO: 'Serviços',
};

export default function VenderPage() {
  const [tipoBem, setTipoBem] = useState<TipoBem>('IMOVEL');
  const [valorCarta, setValorCarta] = useState('150000');
  const [administradora, setAdministradora] = useState('');
  const [faixa, setFaixa] = useState<Faixa | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function simular() {
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch('/api/vender/simular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipoBem,
          valorCarta,
          administradora,
        }),
      });
      if (!res.ok) {
        throw new Error((await res.json()).error ?? 'erro');
      }
      setFaixa(await res.json());
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-sheet-white">
      {/* Hero */}
      <section className="px-6 py-16 md:py-24">
        <div className="mx-auto max-w-5xl">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
            Vendedor · Cota contemplada
          </p>
          <h1 className="font-title text-4xl md:text-6xl font-semibold tracking-tight mt-4 max-w-3xl">
            Pix em 48h pela sua cota.
          </h1>
          <p className="font-text text-lg md:text-xl text-base/80 mt-4 max-w-2xl leading-relaxed">
            Você foi contemplado e precisa de liquidez hoje. A Plina paga via
            Pix em até 48 horas após validação dos documentos. Sem leilão, sem
            fila, sem grupo de Facebook.
          </p>

          {/* Simulador inline */}
          <div className="mt-12 border border-light-hairline">
            <div className="px-6 py-4 border-b border-light-hairline bg-document-grey/50">
              <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                Simulação · faixa indicativa
              </p>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block">
                <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                  Tipo de bem
                </span>
                <select
                  value={tipoBem}
                  onChange={(e) => setTipoBem(e.target.value as TipoBem)}
                  className="mt-2 w-full bg-white border border-light-hairline px-3 py-2.5 font-text text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {(Object.keys(TIPO_BEM_LABEL) as TipoBem[]).map((t) => (
                    <option key={t} value={t}>
                      {TIPO_BEM_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                  Valor da carta
                </span>
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  value={valorCarta}
                  onChange={(e) => setValorCarta(e.target.value)}
                  className="mt-2 w-full bg-white border border-light-hairline px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </label>
              <label className="block">
                <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                  Administradora (opcional)
                </span>
                <input
                  type="text"
                  value={administradora}
                  onChange={(e) => setAdministradora(e.target.value)}
                  placeholder="Ex: Caixa, Itaú, Porto"
                  className="mt-2 w-full bg-white border border-light-hairline px-3 py-2.5 font-text text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </label>
            </div>

            <div className="px-6 pb-6">
              <button
                onClick={simular}
                disabled={loading}
                className="w-full md:w-auto bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors disabled:opacity-50"
              >
                {loading ? 'Calculando…' : 'Calcular o que você recebe'}
              </button>
            </div>

            {erro && (
              <div className="px-6 pb-6">
                <p className="font-text text-sm text-red-700">{erro}</p>
              </div>
            )}

            {faixa && (
              <div className="border-t border-light-hairline bg-base text-lightBg px-6 py-8">
                <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary">
                  Estimativa · sujeita à análise documental
                </p>
                <p className="font-title text-3xl md:text-5xl font-semibold mt-3 tracking-tight">
                  {BRL.format(faixa.valorLiquidoMinimo)} –{' '}
                  {BRL.format(faixa.valorLiquidoMaximo)}
                </p>
                <p className="font-mono text-xs text-lightBg/60 mt-2">
                  Deságio {(faixa.desagioMinimo * 100).toFixed(0)}–
                  {(faixa.desagioMaximo * 100).toFixed(0)}% sobre R${' '}
                  {Number(valorCarta).toLocaleString('pt-BR')}.
                </p>
                <div className="mt-6">
                  <Link
                    href={`/vender/lead?tipoBem=${tipoBem}&valorCarta=${valorCarta}${administradora ? `&administradora=${encodeURIComponent(administradora)}` : ''}`}
                    className="inline-block bg-primary text-base font-details text-[10px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-secondaryLight transition-colors"
                  >
                    Continuar e receber oferta firme →
                  </Link>
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
            Três passos. Pix em 48h.
          </h2>
          <ol className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-px bg-base/15 border border-light-hairline">
            <Step
              n="01"
              titulo="Simule e envie sua oferta"
              copy="Você escolhe tipo de bem e valor. Recebe oferta firme em até 24 horas, com prazo de validade claro."
            />
            <Step
              n="02"
              titulo="Cessão digital + verificação"
              copy="Assinatura via DocuSign. Hash do contrato registrado na Stellar como prova pública e imutável."
            />
            <Step
              n="03"
              titulo="Pix em 48h"
              copy="Após validação, Plina executa o Pix. Comprovante com hash on-chain — você verifica tudo no Stellar Expert."
            />
          </ol>
        </div>
      </section>

      {/* Trust signals */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Por que confiar
          </p>
          <h2 className="font-title text-3xl md:text-4xl font-semibold tracking-tight mt-4">
            Auditável em cada etapa.
          </h2>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-px bg-base/15 border border-light-hairline">
            <TrustBlock
              titulo="Cessão registrada on-chain"
              copy="Cada termo de cessão assinado gera uma transação Stellar com o hash do PDF. Você baixa o contrato + recebe link Stellar Expert pra verificar."
            />
            <TrustBlock
              titulo="Pix com comprovante público"
              copy="Quando o Pix é executado, o hash do comprovante vai pra blockchain. Trilha de auditoria visível, sem depender da Plina."
            />
            <TrustBlock
              titulo="Pool tokenizado regulado"
              copy="Sua cota entra num pool sob estrutura FIDC CVM 175 (Fase 1). Sua identidade fica off-chain, apenas o hash da cessão é público."
            />
            <TrustBlock
              titulo="Sem leilão, sem grupos de Facebook"
              copy="Preço firme, validade declarada, processo digital. Velocidade primeiro: Pix em 48h é o compromisso."
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-document-grey px-6 py-20">
        <div className="mx-auto max-w-3xl">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            FAQ
          </p>
          <h2 className="font-title text-3xl md:text-4xl font-semibold tracking-tight mt-4 mb-10">
            Perguntas frequentes
          </h2>
          <div className="space-y-4">
            <Faq
              q="Quanto vou receber pela minha cota?"
              a="Depende do tipo de bem, valor da carta e administradora. Use o simulador acima pra ver a faixa indicativa. Oferta firme sai após análise documental em até 24h."
            />
            <Faq
              q="O que precisa pra cessão acontecer?"
              a="Contrato de adesão, comprovante de contemplação, extrato atualizado da administradora (até 30d), seu RG/CPF e comprovante de adimplência."
            />
            <Faq
              q="Por que tem deságio?"
              a="O Pix em 48h vem antes da administradora liquidar (90-180d) ou do bem ser usado. O deságio cobre o tempo de imobilização de capital + risco operacional."
            />
            <Faq
              q="A cessão tem validade jurídica?"
              a="Sim. Assinatura via DocuSign com validade civil. No POC testnet usamos sandbox, em produção é DocuSign certificado ICP-Brasil."
            />
            <Faq
              q="Posso desistir depois de assinar?"
              a="Existe uma janela de arrependimento de 24h após a assinatura, antes do Pix ser executado. Após Pix executado, a cessão é irreversível."
            />
            <Faq
              q="Qual a diferença entre vocês e os outros que compram cotas?"
              a="Operamos sob estrutura tokenizada Stellar — cada operação tem hash público auditável. Sua cota vira parte de um pool com transparência on-chain. Os incumbentes vendem ERC-20 sem essa estrutura."
            />
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-title text-3xl md:text-4xl font-semibold tracking-tight">
            Pronto pra receber sua oferta firme?
          </h2>
          <p className="font-text text-base/80 mt-4 max-w-xl mx-auto">
            Cinco minutos pra preencher. Análise em até 24 horas. Pix em 48h
            após cessão assinada.
          </p>
          <Link
            href="/vender/lead"
            className="mt-8 inline-block bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase px-8 py-4 hover:bg-primary-deep transition-colors"
          >
            Solicitar oferta firme →
          </Link>
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

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="border-b border-light-hairline group">
      <summary className="cursor-pointer py-4 font-text text-base font-semibold flex justify-between items-center hover:text-primary-deep transition-colors">
        {q}
        <span className="font-mono text-xs text-base/50 group-open:rotate-45 transition-transform duration-300">
          +
        </span>
      </summary>
      <p className="font-text text-sm text-base/75 pb-4 leading-relaxed pr-8">{a}</p>
    </details>
  );
}
