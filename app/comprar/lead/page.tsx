'use client';

/**
 * /comprar/lead — qualificação do comprador-usuário.
 */

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function explorerTx(hash: string) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

interface Result {
  leadId: string;
  payloadHash: string;
  txHash: string;
}

function LeadInner() {
  const params = useSearchParams();
  const intencaoInicial = params.get('tipoBem') ?? '';
  const valorAlvo = params.get('valorAlvo') ?? '';

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [documento, setDocumento] = useState('');
  const [tipo, setTipo] = useState<'PESSOA_FISICA' | 'PESSOA_JURIDICA'>(
    'PESSOA_FISICA',
  );
  const [intencaoBem, setIntencaoBem] = useState(intencaoInicial);
  const [faixaCapital, setFaixaCapital] = useState('ate-100k');
  const [prazoDecisao, setPrazoDecisao] = useState('imediato');
  const [consentimento, setConsentimento] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch('/api/comprar/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          email,
          telefone,
          documento,
          tipo,
          intencaoBem,
          faixaCapital,
          prazoDecisao,
          consentimentoLgpd: consentimento,
          origem: 'comprar-lead',
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'erro');
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
          Qualificação registrada · auditável
        </p>
        <h1 className="font-title text-4xl md:text-5xl font-semibold tracking-tight mt-4">
          Recebemos sua qualificação.
        </h1>
        <p className="font-text text-base/80 mt-4 leading-relaxed max-w-2xl">
          A equipe Plina entra em contato em até 24h pra apresentar as
          cotas que casam com seu perfil + capacidade declarada. Hash do
          consentimento registrado on-chain.
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

        <p className="font-text text-sm text-base/70 mt-8">
          Lead id: <span className="font-mono text-xs">{result.leadId}</span>
        </p>
        <a
          href="/cotas"
          className="mt-10 inline-block font-details text-[10px] tracking-[0.2em] uppercase underline"
        >
          ← Explorar cotas enquanto isso
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
        Qualificação · 3 minutos
      </p>
      <h1 className="font-title text-4xl md:text-5xl font-semibold tracking-tight mt-4">
        Conta pra gente o que você busca.
      </h1>
      <p className="font-text text-base/80 mt-4 leading-relaxed max-w-2xl">
        A Plina apresenta apenas cotas que casam com seu perfil (tipo de
        bem, prazo, capital). Sem leilão, sem busca infinita.
      </p>

      {valorAlvo && (
        <div className="mt-8 border border-light-hairline p-4 bg-document-grey/40">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Da calculadora
          </p>
          <p className="font-mono text-sm mt-1">
            Valor alvo do bem: R${' '}
            {Number(valorAlvo).toLocaleString('pt-BR')}
          </p>
        </div>
      )}

      <form onSubmit={submit} className="mt-10 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Tipo">
            <div className="mt-2 grid grid-cols-2 border border-light-hairline">
              <button
                type="button"
                onClick={() => setTipo('PESSOA_FISICA')}
                className={`px-4 py-2.5 font-details text-[10px] tracking-[0.2em] uppercase ${
                  tipo === 'PESSOA_FISICA'
                    ? 'bg-base text-lightBg'
                    : 'hover:bg-document-grey'
                }`}
              >
                Pessoa física
              </button>
              <button
                type="button"
                onClick={() => setTipo('PESSOA_JURIDICA')}
                className={`px-4 py-2.5 font-details text-[10px] tracking-[0.2em] uppercase ${
                  tipo === 'PESSOA_JURIDICA'
                    ? 'bg-base text-lightBg'
                    : 'hover:bg-document-grey'
                }`}
              >
                Pessoa jurídica
              </button>
            </div>
          </Field>
          <Field
            label={tipo === 'PESSOA_JURIDICA' ? 'CNPJ' : 'CPF'}
          >
            <input
              type="text"
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              className={inputCls + ' font-mono'}
            />
          </Field>
        </div>

        <Field label="Nome / Razão social" required>
          <input
            type="text"
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Email" required>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Telefone / WhatsApp">
            <input
              type="tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="O que você quer comprar?">
          <input
            type="text"
            value={intencaoBem}
            onChange={(e) => setIntencaoBem(e.target.value)}
            placeholder="Ex: apartamento em São Paulo · caminhão tractor · maquinário"
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Faixa de capital disponível">
            <select
              value={faixaCapital}
              onChange={(e) => setFaixaCapital(e.target.value)}
              className={inputCls}
            >
              <option value="ate-100k">Até R$ 100k</option>
              <option value="100k-300k">R$ 100k – 300k</option>
              <option value="300k-1m">R$ 300k – 1M</option>
              <option value="acima-1m">Acima de R$ 1M</option>
            </select>
          </Field>
          <Field label="Prazo de decisão">
            <select
              value={prazoDecisao}
              onChange={(e) => setPrazoDecisao(e.target.value)}
              className={inputCls}
            >
              <option value="imediato">Imediato</option>
              <option value="30d">Em 30 dias</option>
              <option value="90d">Em 90 dias</option>
              <option value="exploratorio">Apenas explorando</option>
            </select>
          </Field>
        </div>

        <label className="flex items-start gap-3 cursor-pointer pt-2">
          <input
            type="checkbox"
            required
            checked={consentimento}
            onChange={(e) => setConsentimento(e.target.checked)}
            className="mt-1.5 w-4 h-4 accent-primary"
          />
          <span className="font-text text-sm text-base/75 leading-relaxed">
            Concordo com o tratamento dos meus dados pessoais. Hash do
            consentimento será registrado publicamente na Stellar.
          </span>
        </label>

        {erro && <p className="font-text text-sm text-red-700">{erro}</p>}

        <button
          type="submit"
          disabled={loading || !consentimento}
          className="bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase px-8 py-4 hover:bg-primary-deep transition-colors disabled:opacity-50"
        >
          {loading ? 'Enviando…' : 'Receber cotas que casam com meu perfil'}
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

export default function ComprarLeadPage() {
  return (
    <Suspense fallback={<div className="px-6 py-16">Carregando…</div>}>
      <LeadInner />
    </Suspense>
  );
}
