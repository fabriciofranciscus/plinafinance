'use client';

/**
 * /vender — wizard "Para Cotistas" (flow desenhado pelo CEO no mockup Lovable).
 *
 * Passo 1 (Cadastro & KYC) é feito UMA vez e é gated por login Privy:
 *   (a) não logado          → painel de login (Google / e-mail)
 *   (b) logado + sem KYC     → form de KYC + conta Pix → POST /api/conta/kyc
 *   (c) logado + KYC aprovado → pula direto pro passo 2 (chip "verificado")
 * KYC vive na Pessoa (privyId) e vale pros dois papéis (investidor/cedente).
 *
 * Passo 2 (Envio da cota) cria o lead via /api/vender/lead (autenticado) →
 * acompanhamento em /vender/acompanhar/[leadId].
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import WizardHeader from '@/components/vender/WizardHeader';
import StepperVender from '@/components/vender/StepperVender';
import { usePessoa } from '@/components/PessoaProvider';
import {
  useAppPrivy,
  useAppLoginWithEmail,
  useAppLoginWithOAuth,
} from '@/lib/hooks/privy';

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

const inputClass =
  'mt-2 w-full bg-white border border-light-hairline px-4 py-2.5 font-text text-sm focus:outline-none focus:ring-2 focus:ring-primary';

function WizardInner() {
  const router = useRouter();
  const params = useSearchParams();
  const pessoa = usePessoa();
  const { getAccessToken } = useAppPrivy();

  const [passo, setPasso] = useState<0 | 1>(0);

  // Passo 2 — Envio da cota
  const [tipoBem, setTipoBem] = useState<TipoBem>(
    (params.get('tipoBem') as TipoBem) || 'IMOVEL',
  );
  const [valorCarta, setValorCarta] = useState(
    params.get('valorCarta') || '150000',
  );
  const [administradora, setAdministradora] = useState(
    params.get('administradora') || '',
  );
  const [faixa, setFaixa] = useState<Faixa | null>(null);
  const [simulando, setSimulando] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // (c) já verificado → pula pro passo 2 UMA vez. Depois disso, "Voltar" e o
  // clique no stepper podem trazer o cedente de volta ao passo 0 sem que o
  // efeito o empurre pra frente de novo.
  const autoAvancou = useRef(false);
  useEffect(() => {
    if (
      !autoAvancou.current &&
      pessoa.authenticated &&
      pessoa.kycAprovado &&
      passo === 0
    ) {
      autoAvancou.current = true;
      setPasso(1);
    }
  }, [pessoa.authenticated, pessoa.kycAprovado, passo]);

  // Navegação Voltar/Avançar + stepper clicável (igual ao mockup). Passos
  // futuros (Validação jurídica em diante) são dirigidos pela mesa — ficam
  // bloqueados aqui; só Cadastro & KYC (0) e Envio da cota (1) são do cedente.
  const podeEnviar = pessoa.authenticated && pessoa.kycAprovado;
  function irParaPasso(idx: number) {
    if (idx === 0) setPasso(0);
    else if (idx === 1 && podeEnviar) setPasso(1);
  }
  function passoHabilitado(idx: number) {
    if (!pessoa.authenticated) return false;
    if (idx === 0) return true;
    if (idx === 1) return podeEnviar;
    return false; // passos da mesa
  }

  async function simular() {
    setSimulando(true);
    setErro(null);
    try {
      const res = await fetch('/api/vender/simular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipoBem, valorCarta, administradora }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'erro');
      setFaixa(await res.json());
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSimulando(false);
    }
  }

  async function enviar() {
    setEnviando(true);
    setErro(null);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/vender/lead', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ consentimentoLgpd: true, origem: 'wizard-vender' }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'erro');
      const { leadId } = (await res.json()) as { leadId: string };
      router.push(`/vender/acompanhar/${leadId}`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen bg-sheet-white text-base flex flex-col">
      <WizardHeader active="cotistas" />

      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-6 pt-12 pb-20">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
            Para Cotistas
          </p>
          <h1 className="font-title text-4xl md:text-5xl font-semibold tracking-tight mt-3">
            Venda sua cota contemplada
          </h1>
          <p className="font-text text-lg text-base/70 mt-3">
            Pix em até 48h. Deságio transparente. Processo 100% digital.
          </p>

          <div className="mt-12">
            <StepperVender
              current={passo}
              onStepClick={irParaPasso}
              isStepEnabled={passoHabilitado}
            />
          </div>

          <div className="mt-10 border border-light-hairline bg-white p-6 md:p-8">
            {passo === 0 ? (
              pessoa.loading ? (
                <p className="font-text text-sm text-base/60">Carregando…</p>
              ) : !pessoa.authenticated ? (
                <LoginPanel />
              ) : pessoa.kycAprovado ? (
                <VerificadoPanel email={pessoa.email} nome={pessoa.nome} />
              ) : (
                <KycPanel
                  emailPadrao={pessoa.email}
                  nomePadrao={pessoa.nome}
                  getAccessToken={getAccessToken}
                  onDone={async () => {
                    await pessoa.refresh();
                    setPasso(1);
                  }}
                />
              )
            ) : (
              <PassoEnvioCota
                tipoBem={tipoBem}
                setTipoBem={setTipoBem}
                valorCarta={valorCarta}
                setValorCarta={setValorCarta}
                administradora={administradora}
                setAdministradora={setAdministradora}
                faixa={faixa}
                simulando={simulando}
                simular={simular}
                verificado={pessoa.kycAprovado}
              />
            )}

            {erro && passo === 1 && (
              <p className="font-text text-sm text-red-700 mt-6">{erro}</p>
            )}

            {/* Navegação Voltar/Avançar (igual ao mockup). Aparece quando o
                cedente já está verificado — antes disso, login/KYC têm os
                próprios botões de ação. */}
            {podeEnviar && (
              <div className="mt-8 flex items-center justify-between border-t border-light-hairline pt-6">
                <button
                  type="button"
                  onClick={() => setPasso(0)}
                  disabled={passo === 0}
                  className="font-details text-[11px] tracking-[0.2em] uppercase text-base/60 hover:text-base transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ← Voltar
                </button>
                {passo === 0 ? (
                  <button
                    type="button"
                    onClick={() => setPasso(1)}
                    className="bg-base text-lightBg font-details text-[11px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors"
                  >
                    Avançar →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={enviar}
                    disabled={enviando}
                    className="bg-base text-lightBg font-details text-[11px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors disabled:opacity-50"
                  >
                    {enviando ? 'Enviando…' : 'Enviar e acompanhar →'}
                  </button>
                )}
              </div>
            )}
          </div>

          <p className="font-text text-sm text-base/60 mt-8 leading-relaxed">
            Depois do envio, nossa mesa faz a validação jurídica, gera a oferta
            firme e conduz a cessão digital. Você acompanha cada etapa, com Pix
            em até 48h após a assinatura, por um link auditável.
          </p>
        </div>
      </main>
    </div>
  );
}

// ─── Passo 0a — Login ────────────────────────────────────────────────────────

function LoginPanel() {
  const { initOAuth, loading: oauthLoading } = useAppLoginWithOAuth();
  const { sendCode, loginWithCode, state } = useAppLoginWithEmail();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const sending = state.status === 'sending-code';
  const verifying = state.status === 'submitting-code';
  const awaitingCode = state.status === 'awaiting-code-input' || verifying;

  return (
    <div>
      <h2 className="font-title text-2xl font-semibold tracking-tight">
        Entre para começar
      </h2>
      <p className="font-text text-sm text-base/70 mt-1">
        Seu cadastro e verificação são feitos uma única vez. Use Google ou
        e-mail.
      </p>

      {!awaitingCode ? (
        <div className="mt-6 space-y-5">
          <button
            type="button"
            onClick={async () => {
              setErro(null);
              try {
                await initOAuth({ provider: 'google' });
              } catch (e) {
                setErro(e instanceof Error ? e.message : 'Falha no Google.');
              }
            }}
            disabled={oauthLoading}
            className="inline-flex items-center gap-3 border border-base/20 bg-white px-5 py-3 font-details text-[11px] tracking-[0.2em] uppercase hover:border-base transition-colors disabled:opacity-40"
          >
            {oauthLoading ? 'Redirecionando…' : 'Continuar com Google'}
          </button>

          <div className="flex items-center gap-4" aria-hidden>
            <span className="h-px flex-1 bg-base/15" />
            <span className="font-details text-[10px] tracking-[0.3em] uppercase text-base/55">
              ou
            </span>
            <span className="h-px flex-1 bg-base/15" />
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setErro(null);
              try {
                await sendCode({ email });
              } catch (er) {
                setErro(er instanceof Error ? er.message : 'Falha ao enviar.');
              }
            }}
          >
            <label className="block">
              <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                E-mail
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sending}
                className={inputClass}
              />
            </label>
            <button
              type="submit"
              disabled={sending || !email}
              className="mt-4 bg-base text-lightBg font-details text-[11px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors disabled:opacity-40"
            >
              {sending ? 'Enviando…' : 'Enviar código'}
            </button>
          </form>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setErro(null);
            try {
              await loginWithCode({ code });
            } catch (er) {
              setErro(er instanceof Error ? er.message : 'Código inválido.');
            }
          }}
          className="mt-6"
        >
          <label className="block">
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
              Código enviado para {email}
            </span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={inputClass + ' font-mono tracking-[0.3em]'}
            />
          </label>
          <button
            type="submit"
            disabled={verifying || code.length < 6}
            className="mt-4 bg-base text-lightBg font-details text-[11px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors disabled:opacity-40"
          >
            {verifying ? 'Verificando…' : 'Entrar'}
          </button>
        </form>
      )}

      {erro && <p className="font-text text-sm text-red-700 mt-4">{erro}</p>}
    </div>
  );
}

// ─── Passo 0b — KYC + conta Pix ──────────────────────────────────────────────

const PIX_TIPOS = [
  { v: 'cpf', label: 'CPF' },
  { v: 'email', label: 'E-mail' },
  { v: 'phone', label: 'Telefone' },
  { v: 'random', label: 'Aleatória' },
] as const;

function KycPanel({
  emailPadrao,
  nomePadrao,
  getAccessToken,
  onDone,
}: {
  emailPadrao: string | null;
  nomePadrao: string | null;
  getAccessToken: () => Promise<string | null>;
  onDone: () => Promise<void>;
}) {
  const [nome, setNome] = useState(nomePadrao ?? '');
  const [cpf, setCpf] = useState('');
  const [pixKeyType, setPixKeyType] = useState<'cpf' | 'email' | 'phone' | 'random'>('cpf');
  const [pixKey, setPixKey] = useState('');
  const [consentimento, setConsentimento] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valido = nome.trim() && cpf.trim() && pixKey.trim() && consentimento;

  async function submit() {
    setLoading(true);
    setErro(null);
    try {
      const cpfDigits = cpf.replace(/\D/g, '');
      const [firstName, ...rest] = nome.trim().split(' ');
      const token = await getAccessToken();
      const res = await fetch('/api/conta/kyc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          nome: nome.trim(),
          cpf: cpfDigits,
          papel: 'CEDENTE',
          bankAccount: {
            pixKey: pixKey.trim(),
            pixKeyType,
            firstName: firstName || nome.trim(),
            lastName: rest.join(' ') || 'Plina',
            cpf: cpfDigits,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'erro');
      await onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="font-title text-2xl font-semibold tracking-tight">
        Cadastro &amp; KYC
      </h2>
      <p className="font-text text-sm text-base/70 mt-1">
        Verificação AML/KYC obrigatória conforme regulação BACEN/COAF. Feita uma
        única vez{emailPadrao ? ` para ${emailPadrao}` : ''}.
      </p>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Nome completo" required>
          <input
            type="text"
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="CPF" required>
          <input
            type="text"
            required
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="000.000.000-00"
            className={inputClass + ' font-mono'}
          />
        </Field>
      </div>

      <div className="mt-6">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
          Conta para receber o Pix
        </p>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4">
          <Field label="Tipo de chave">
            <select
              value={pixKeyType}
              onChange={(e) => setPixKeyType(e.target.value as typeof pixKeyType)}
              className={inputClass}
            >
              {PIX_TIPOS.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Chave Pix">
            <input
              type="text"
              value={pixKey}
              onChange={(e) => setPixKey(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </div>

      <div className="mt-5">
        <span className="inline-flex items-center gap-1.5 border border-primary/30 bg-primary/5 px-3 py-1 font-mono text-[11px] text-base/70">
          <span className="h-1 w-1 rounded-full bg-primary" />
          SEP-12 · KYC padronizado
        </span>
      </div>

      <label className="flex items-start gap-3 cursor-pointer mt-6">
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
          . Entendo que o hash desse consentimento será registrado publicamente
          na Stellar como prova auditável.
        </span>
      </label>

      {erro && <p className="font-text text-sm text-red-700 mt-4">{erro}</p>}

      <div className="mt-8 flex justify-end border-t border-light-hairline pt-6">
        <button
          type="button"
          onClick={submit}
          disabled={!valido || loading}
          className="bg-base text-lightBg font-details text-[11px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Verificando…' : 'Concluir cadastro →'}
        </button>
      </div>
    </div>
  );
}

// ─── Passo 0c — Conta já verificada (revisão ao voltar) ──────────────────────

function VerificadoPanel({
  email,
  nome,
}: {
  email: string | null;
  nome: string | null;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-title text-2xl font-semibold tracking-tight">
          Cadastro &amp; KYC
        </h2>
        <span className="inline-flex items-center gap-1.5 border border-primary/30 bg-primary/5 px-3 py-1 font-mono text-[11px] text-base/70 shrink-0">
          <span className="h-1 w-1 rounded-full bg-primary" />
          KYC verificado
        </span>
      </div>
      <p className="font-text text-sm text-base/70 mt-1">
        Sua verificação AML/KYC já está concluída{nome ? `, ${nome}` : ''}. Ela
        vale para venda e investimento — não precisa refazer.
      </p>
      {email && (
        <p className="font-mono text-xs text-base/55 mt-4">{email}</p>
      )}
      <p className="font-text text-sm text-base/60 mt-6">
        Avance para enviar sua cota.
      </p>
    </div>
  );
}

// ─── Passo 1 — Envio da cota ─────────────────────────────────────────────────

function PassoEnvioCota(props: {
  tipoBem: TipoBem;
  setTipoBem: (v: TipoBem) => void;
  valorCarta: string;
  setValorCarta: (v: string) => void;
  administradora: string;
  setAdministradora: (v: string) => void;
  faixa: Faixa | null;
  simulando: boolean;
  simular: () => void;
  verificado: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-title text-2xl font-semibold tracking-tight">
          Envio da cota
        </h2>
        {props.verificado && (
          <span className="inline-flex items-center gap-1.5 border border-primary/30 bg-primary/5 px-3 py-1 font-mono text-[11px] text-base/70 shrink-0">
            <span className="h-1 w-1 rounded-full bg-primary" />
            KYC verificado
          </span>
        )}
      </div>
      <p className="font-text text-sm text-base/70 mt-1">
        Informe sua cota para estimarmos o valor líquido. A oferta firme sai
        após análise documental.
      </p>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Tipo de bem">
          <select
            value={props.tipoBem}
            onChange={(e) => props.setTipoBem(e.target.value as TipoBem)}
            className={inputClass}
          >
            {(Object.keys(TIPO_BEM_LABEL) as TipoBem[]).map((t) => (
              <option key={t} value={t}>
                {TIPO_BEM_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Valor da carta">
          <input
            type="number"
            min="1000"
            step="1000"
            value={props.valorCarta}
            onChange={(e) => props.setValorCarta(e.target.value)}
            className={inputClass + ' font-mono'}
          />
        </Field>
        <Field label="Administradora (opcional)">
          <input
            type="text"
            value={props.administradora}
            onChange={(e) => props.setAdministradora(e.target.value)}
            placeholder="Ex: Caixa, Itaú, Porto"
            className={inputClass}
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={props.simular}
        disabled={props.simulando}
        className="mt-6 font-details text-[11px] tracking-[0.2em] uppercase border border-base/20 px-5 py-2.5 hover:border-base transition-colors disabled:opacity-50"
      >
        {props.simulando ? 'Calculando…' : 'Calcular estimativa'}
      </button>

      {props.faixa && (
        <div className="mt-6 border-t border-light-hairline bg-base text-lightBg px-6 py-7 -mx-6 md:mx-0 md:border md:border-light-hairline">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary">
            Estimativa · sujeita à análise documental
          </p>
          <p className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight">
            {BRL.format(props.faixa.valorLiquidoMinimo)} –{' '}
            {BRL.format(props.faixa.valorLiquidoMaximo)}
          </p>
          <p className="font-mono text-xs text-lightBg/60 mt-2">
            Deságio {(props.faixa.desagioMinimo * 100).toFixed(0)}–
            {(props.faixa.desagioMaximo * 100).toFixed(0)}% sobre R${' '}
            {Number(props.valorCarta).toLocaleString('pt-BR')}.
          </p>
        </div>
      )}
    </div>
  );
}

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

export default function VenderPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-sheet-white px-6 py-16 font-text text-base/60">
          Carregando…
        </div>
      }
    >
      <WizardInner />
    </Suspense>
  );
}
