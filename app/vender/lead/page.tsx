'use client';

/**
 * /vender/lead — form de captura + confirmação.
 *
 * Pré-preenche tipo/valor via query string vindo do /vender simulador.
 * Consentimento LGPD obrigatório (vai pra blockchain como prova).
 * Após captura → tela de "obrigado" com hash on-chain + link Stellar Expert.
 */

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface LeadResult {
  leadId: string;
  payloadHash: string;
  txHash: string;
}

function explorerTx(hash: string) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

function LeadFormInner() {
  const params = useSearchParams();
  const tipoBem = params.get('tipoBem') ?? '';
  const valorCarta = params.get('valorCarta') ?? '';
  const administradora = params.get('administradora') ?? '';

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [cpf, setCpf] = useState('');
  const [consentimento, setConsentimento] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [result, setResult] = useState<LeadResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch('/api/vender/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          email,
          telefone,
          cpf,
          consentimentoLgpd: consentimento,
          origem: 'lead-form',
        }),
      });
      if (!res.ok) {
        throw new Error((await res.json()).error ?? 'erro');
      }
      setResult(await res.json());
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
          Captura registrada · auditável
        </p>
        <h1 className="font-title text-4xl md:text-5xl font-semibold tracking-tight mt-4">
          Recebemos sua solicitação.
        </h1>
        <p className="font-text text-base/80 mt-4 leading-relaxed max-w-2xl">
          A equipe Plina vai entrar em contato em até 24 horas com a oferta
          firme. Enquanto isso, registramos seu consentimento como hash público
          na blockchain Stellar.
        </p>

        <div className="mt-10 border border-light-hairline p-6 bg-document-grey/40">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Prova on-chain · consentimento LGPD
          </p>
          <p className="font-mono text-xs text-base/85 mt-3 break-all">
            SHA-256: {result.payloadHash}
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

        <p className="font-text text-sm text-base/70 mt-8 leading-relaxed">
          Lead id: <span className="font-mono text-xs">{result.leadId}</span>.
          Guarde esse identificador caso precise referenciar com a operação.
        </p>

        <div className="mt-10 border-t border-light-hairline pt-8">
          <a
            href="/vender"
            className="font-details text-[10px] tracking-[0.2em] uppercase underline text-base/70"
          >
            ← Voltar ao simulador
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
        Solicitação · oferta firme em até 24h
      </p>
      <h1 className="font-title text-4xl md:text-5xl font-semibold tracking-tight mt-4">
        Vamos preparar sua oferta.
      </h1>
      <p className="font-text text-base/80 mt-4 leading-relaxed max-w-2xl">
        Cinco minutos. Análise documental em até 24 horas. Pix em até 48h
        após cessão assinada.
      </p>

      {(tipoBem || valorCarta) && (
        <div className="mt-8 border border-light-hairline p-4 bg-document-grey/40">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 mb-2">
            Da simulação anterior
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm font-text">
            {tipoBem && (
              <div>
                <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                  Tipo
                </p>
                <p>{tipoBem}</p>
              </div>
            )}
            {valorCarta && (
              <div>
                <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                  Valor da carta
                </p>
                <p className="font-mono">
                  R$ {Number(valorCarta).toLocaleString('pt-BR')}
                </p>
              </div>
            )}
            {administradora && (
              <div>
                <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                  Administradora
                </p>
                <p>{administradora}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <form onSubmit={submit} className="mt-10 space-y-5">
        <Field label="Nome completo" required>
          <input
            type="text"
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Email" required>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Telefone (WhatsApp)">
          <input
            type="tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="(11) 99999-9999"
            className={inputClass}
          />
        </Field>
        <Field label="CPF">
          <input
            type="text"
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="000.000.000-00"
            className={inputClass + ' font-mono'}
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
            Concordo com o tratamento dos meus dados pessoais conforme a{' '}
            <a href="/politica-clawback" className="underline">
              política
            </a>
            . Entendo que o hash desse consentimento será registrado
            publicamente na Stellar como prova auditável.
          </span>
        </label>

        {erro && (
          <p className="font-text text-sm text-red-700">{erro}</p>
        )}

        <button
          type="submit"
          disabled={loading || !consentimento}
          className="bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase px-8 py-4 hover:bg-primary-deep transition-colors disabled:opacity-50"
        >
          {loading ? 'Enviando…' : 'Enviar e receber oferta firme'}
        </button>
      </form>
    </div>
  );
}

const inputClass =
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

export default function LeadPage() {
  return (
    <Suspense fallback={<div className="px-6 py-16">Carregando…</div>}>
      <LeadFormInner />
    </Suspense>
  );
}
