'use client';

/**
 * /painel — hub pessoal pós-login (retorno).
 *
 * Role-aware via usePessoa().papeis: investidor vê atalho pra posição; cedente
 * vê atalhos de venda/acompanhamento; mais CTAs pra iniciar novas ações. Client
 * component porque o token Privy é client-side (padrão do /minha-posicao).
 *
 * Guarda: deslogado → /entrar. Aceita usuário sem papel (primeiro acesso): a
 * seção "Iniciar" funciona como seletor de caminho; "Suas atividades" só aparece
 * pra quem já tem papel.
 */

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAppPrivy } from '@/lib/hooks/privy';
import { usePessoa } from '@/components/PessoaProvider';

function Card({
  href,
  eyebrow,
  title,
  desc,
}: {
  href: string;
  eyebrow: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group relative block bg-white px-7 py-7 transition-colors hover:bg-lightBg/40"
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[2px] origin-top scale-y-0 bg-primary transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-y-100"
      />
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
        {eyebrow}
      </p>
      <p className="font-title text-xl font-semibold mt-2 tracking-tight text-base group-hover:text-primary-deep transition-colors">
        {title}
      </p>
      <p className="font-text text-sm mt-2 text-base/70 leading-relaxed">{desc}</p>
    </Link>
  );
}

export default function PainelPage() {
  const router = useRouter();
  const { ready } = useAppPrivy();
  const pessoa = usePessoa();
  const routed = useRef(false);

  useEffect(() => {
    if (routed.current) return;
    if (!ready || pessoa.loading) return;
    if (!pessoa.authenticated) {
      routed.current = true;
      router.replace('/entrar?next=/painel');
    }
  }, [ready, pessoa.loading, pessoa.authenticated, router]);

  if (!ready || pessoa.loading || !pessoa.authenticated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 animate-pulse">
          Carregando…
        </p>
      </div>
    );
  }

  const isInvestidor = pessoa.papeis.includes('INVESTIDOR');
  const isCedente = pessoa.papeis.includes('CEDENTE');
  const primeiroNome = pessoa.nome?.split(' ')[0] ?? null;

  return (
    <div className="bg-lightBg min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-16 md:py-20">
        <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
          Painel · PLINA-RF
        </p>
        <h1 className="font-title text-3xl md:text-4xl font-semibold mt-4 tracking-tight leading-tight text-base">
          {primeiroNome ? `Olá, ${primeiroNome}.` : 'Olá.'}
        </h1>
        <p className="font-text text-base mt-3 text-base/70 leading-relaxed max-w-prose">
          {isInvestidor || isCedente
            ? 'Suas atividades e novos caminhos no PLINA-RF.'
            : 'Escolha por onde começar.'}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span
            className={`font-details text-[10px] tracking-[0.2em] uppercase px-3 py-1 rounded-full border ${
              pessoa.kycAprovado
                ? 'border-primary/30 bg-primary/5 text-primary-deep'
                : 'border-base/20 text-base/60'
            }`}
          >
            {pessoa.kycAprovado ? '● KYC verificado' : `○ KYC ${pessoa.kycStatus ?? 'pendente'}`}
          </span>
          {isInvestidor && (
            <span className="font-details text-[10px] tracking-[0.2em] uppercase px-3 py-1 rounded-full border border-base/20 text-base/60">
              Investidor
            </span>
          )}
          {isCedente && (
            <span className="font-details text-[10px] tracking-[0.2em] uppercase px-3 py-1 rounded-full border border-base/20 text-base/60">
              Cedente
            </span>
          )}
        </div>

        {/* Seções por papel já ativo. */}
        {(isInvestidor || isCedente) && (
          <div className="mt-12">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 mb-4">
              Suas atividades
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-base/10 border-y border-light-hairline">
              {isInvestidor && (
                <Card
                  href="/minha-posicao"
                  eyebrow="Investidor"
                  title="Minha posição"
                  desc="Saldo PLINA-RF, custódia, composição do pool e janela de resgate."
                />
              )}
              {isCedente && (
                <Card
                  href="/vender"
                  eyebrow="Cedente"
                  title="Acompanhar venda"
                  desc="Status da cessão da sua cota — validação jurídica, oferta e Pix."
                />
              )}
            </div>
          </div>
        )}

        {/* Iniciar novas ações. */}
        <div className="mt-12">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 mb-4">
            Iniciar
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-base/10 border-y border-light-hairline">
            <Card
              href="/investir"
              eyebrow="01"
              title="Investir"
              desc="Alocar capital no pool PLINA-RF."
            />
            <Card
              href="/vender"
              eyebrow="02"
              title="Vender cota"
              desc="Antecipar liquidez de uma cota contemplada."
            />
            <Card
              href="/comprar"
              eyebrow="03"
              title="Comprar cota"
              desc="Adquirir uma cota com deságio."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
