'use client';

/**
 * /comprar/reservar?cotaId=... — reserva expressa (72h).
 *
 * Exige login Privy: o lead é derivado server-side da sessão (sem IDOR). A tela
 * é uma confirmação de consentimento + reserva; nome/email vêm da sessão.
 */

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAppPrivy } from '@/lib/hooks/privy';
import { useRequireAuth } from '@/lib/hooks/use-require-auth';
import { postJson } from '@/lib/http/client';

function explorerTx(hash: string) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

interface ReservaResult {
  reservaId: string;
  expiraEm: string;
  txHash: string;
}

function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const { getAccessToken } = useAppPrivy();
  const { checking, authenticated } = useRequireAuth();
  const cotaId = params.get('cotaId');
  const [consentimento, setConsentimento] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [result, setResult] = useState<ReservaResult | null>(null);

  if (checking || !authenticated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 animate-pulse">
          Verificando acesso…
        </p>
      </div>
    );
  }

  if (!cotaId) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="font-text text-base/70">
          Sem cotaId. Volte e escolha uma cota.
        </p>
        <button
          onClick={() => router.push('/cotas')}
          className="mt-6 font-details text-[10px] tracking-[0.2em] uppercase underline"
        >
          Ver cotas →
        </button>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErro(null);
    try {
      const data = await postJson<ReservaResult>(
        '/api/comprar/reservar',
        { cotaId },
        getAccessToken,
      );
      setResult(data);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
          Reserva ativa · 72h
        </p>
        <h1 className="font-title text-4xl md:text-5xl font-semibold tracking-tight mt-4">
          Cota travada pra você.
        </h1>
        <p className="font-text text-base/80 mt-4 leading-relaxed max-w-2xl">
          A Plina vai entrar em contato em até 24h pra qualificar a
          transferência. Sua janela de reserva expira em{' '}
          <span className="font-mono text-sm">
            {new Date(result.expiraEm).toLocaleString('pt-BR', { hour12: false })}
          </span>
          .
        </p>

        <div className="mt-10 border border-light-hairline p-6 bg-document-grey/40">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Reserva auditável on-chain
          </p>
          <p className="font-mono text-xs text-base/85 mt-3 break-all">
            Reserva: {result.reservaId}
          </p>
          <a
            href={explorerTx(result.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block font-details text-[10px] tracking-[0.2em] uppercase underline text-primary-deep hover:text-primary"
          >
            Ver no Stellar Expert →
          </a>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <a
            href="/cotas"
            className="font-details text-[10px] tracking-[0.2em] uppercase underline text-base/70"
          >
            ← Ver outras cotas
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
        Reserva · 72h
      </p>
      <h1 className="font-title text-4xl md:text-5xl font-semibold tracking-tight mt-4">
        Trave a cota enquanto qualifica.
      </h1>
      <p className="font-text text-base/80 mt-4 max-w-2xl leading-relaxed">
        Confirme a reserva. Após travada, a Plina entra em contato em até 24
        horas com instruções de qualificação + transferência.
      </p>

      <form onSubmit={submit} className="mt-10 space-y-5">
        <label className="flex items-start gap-3 cursor-pointer pt-2">
          <input
            type="checkbox"
            required
            checked={consentimento}
            onChange={(e) => setConsentimento(e.target.checked)}
            className="mt-1.5 w-4 h-4 accent-primary"
          />
          <span className="font-text text-sm text-base/75 leading-relaxed">
            Concordo com o tratamento dos meus dados. Hash do consentimento
            + hash da reserva serão registrados na Stellar.
          </span>
        </label>

        {erro && <p className="font-text text-sm text-red-700">{erro}</p>}

        <button
          type="submit"
          disabled={loading || !consentimento}
          className="bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase px-8 py-4 hover:bg-primary-deep transition-colors disabled:opacity-50"
        >
          {loading ? 'Reservando…' : 'Confirmar reserva por 72h'}
        </button>
      </form>
    </div>
  );
}

export default function ReservarPage() {
  return (
    <Suspense fallback={<div className="px-6 py-16">Carregando…</div>}>
      <Inner />
    </Suspense>
  );
}
