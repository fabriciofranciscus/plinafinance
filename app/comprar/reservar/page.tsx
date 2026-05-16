'use client';

/**
 * /comprar/reservar?cotaId=... — reserva expressa.
 *
 * Se o usuário ainda não é lead, captura email + nome inline (cria
 * LeadComprador NOVO + audit), em seguida cria reserva. Reserva expira em 72h.
 */

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

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
  const cotaId = params.get('cotaId');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [consentimento, setConsentimento] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [result, setResult] = useState<ReservaResult | null>(null);

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
      // 1) cria/recupera lead
      const leadRes = await fetch('/api/comprar/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          email,
          telefone,
          tipo: 'PESSOA_FISICA',
          consentimentoLgpd: consentimento,
          origem: 'reservar-direto',
        }),
      });
      if (!leadRes.ok) throw new Error((await leadRes.json()).error ?? 'erro no lead');
      const { leadId } = (await leadRes.json()) as { leadId: string };

      // 2) cria reserva
      const reservaRes = await fetch('/api/comprar/reservar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cotaId, leadCompradorId: leadId }),
      });
      if (!reservaRes.ok)
        throw new Error((await reservaRes.json()).error ?? 'erro na reserva');
      setResult((await reservaRes.json()) as ReservaResult);
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
        Cinco campos. Após reserva, Plina entra em contato em até 24 horas
        com instruções de qualificação + transferência.
      </p>

      <form onSubmit={submit} className="mt-10 space-y-5">
        <Field label="Nome completo" required>
          <input
            type="text"
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Email" required>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Telefone (WhatsApp)">
          <input
            type="tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            className={inputCls}
          />
        </Field>

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

const inputCls =
  'mt-2 w-full bg-white border border-light-hairline px-4 py-2.5 font-text text-sm focus:outline-none focus:ring-2 focus:ring-primary';

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
        {label} {required && <span className="text-primary-deep">*</span>}
      </span>
      {children}
    </label>
  );
}

export default function ReservarPage() {
  return (
    <Suspense fallback={<div className="px-6 py-16">Carregando…</div>}>
      <Inner />
    </Suspense>
  );
}
