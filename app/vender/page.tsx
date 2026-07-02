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
import { useRequireAuth } from '@/lib/hooks/use-require-auth';
import {
  useAppPrivy,
  useAppLoginWithEmail,
  useAppLoginWithOAuth,
} from '@/lib/hooks/privy';
import { withTimeout } from '@/lib/http/client';
import { isMaiorDeIdade, dataMaximaNascimentoISO } from '@/lib/format/idade';
import { parseCpf } from '@/lib/format/parse-cpf';
import { isUfValida } from '@/lib/format/uf';

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

// Espelha ETHERFUSE_ENV do servidor (lib/env/etherfuse.ts) — decide se a UI
// mostra os campos opcionais de KYC (só produção, já que em sandbox são
// omitidos do payload de qualquer jeito) e se as 3 fotos são obrigatórias
// pra habilitar o submit. Os dois envs precisam ser mantidos em sincronia
// manualmente (NEXT_PUBLIC_* é embutido no build, ETHERFUSE_ENV é runtime).
const KYC_IS_PRODUCTION = process.env.NEXT_PUBLIC_ETHERFUSE_ENV === 'production';

const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_JPEG_QUALITY = 0.82;

/** Redimensiona (lado maior <=1600px) e recomprime como JPEG antes de virar
 *  base64 — mantém bem abaixo do limite de 10MB/request da Etherfuse e do
 *  payload razoável pra nossa própria API route. */
function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D não suportado.'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Não foi possível ler a imagem.'));
    };
    img.src = objectUrl;
  });
}

// ─── Máscaras de input (CPF/telefone/CEP) ───────────────────────────────────
// Estado guarda só dígitos; a máscara é aplicada na exibição. Telefone assume
// BR sem DDI (normalizado pra E.164 com +55 só no momento do submit — ver
// KycPanel.submit).

function onlyDigits(value: string, max: number): string {
  return value.replace(/\D/g, '').slice(0, max);
}

function maskCpf(digits: string): string {
  const p = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)].filter(Boolean);
  let out = p.join('.');
  if (digits.length > 9) out += '-' + digits.slice(9, 11);
  return out;
}

function maskTelefoneBR(digits: string): string {
  if (digits.length <= 2) return digits;
  const ddd = digits.slice(0, 2);
  const resto = digits.slice(2);
  if (resto.length <= 4) return `(${ddd}) ${resto}`;
  if (digits.length <= 10) return `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}`;
  return `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5, 9)}`;
}

function maskCep(digits: string): string {
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

type SecaoId = 'identidade' | 'endereco' | 'documento' | 'pix';

/** Ao `completa` transicionar de false→true, colapsa `de` e abre `para` —
 *  só se o usuário não tiver mexido manualmente no toggle de `de` antes
 *  (senão o auto-avanço reabriria algo que ele fechou de propósito). */
function useAutoAvancoSecao(
  completa: boolean,
  de: SecaoId,
  para: SecaoId,
  setAbertas: React.Dispatch<React.SetStateAction<Record<SecaoId, boolean>>>,
  manualToggle: React.MutableRefObject<Record<SecaoId, boolean>>,
) {
  const eraCompleta = useRef(false);
  useEffect(() => {
    if (completa && !eraCompleta.current && !manualToggle.current[de]) {
      setAbertas((a) => ({ ...a, [de]: false, [para]: true }));
    }
    eraCompleta.current = completa;
  }, [completa, de, para, setAbertas, manualToggle]);
}

function ChevronIcon({ aberto }: { aberto: boolean }) {
  return (
    <svg
      viewBox="0 0 12 8"
      className={
        'h-2.5 w-3 shrink-0 fill-none stroke-current stroke-[1.5] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ' +
        (aberto ? 'rotate-180' : '')
      }
    >
      <path d="M1 1.5L6 6.5L11 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Cabeçalho de seção no padrão "numbered list item" do DESIGN.md: numeral
 *  mono em rest, ponto cyan quando aberta, check cyan quando completa.
 *  Seções completas colapsam pra um resumo de uma linha — reduz a sensação
 *  de parede de campos sem forçar navegação rígida entre passos. */
function Secao({
  numero,
  titulo,
  completa,
  resumo,
  aberta,
  onToggle,
  children,
}: {
  numero: string;
  titulo: string;
  completa: boolean;
  resumo?: string;
  aberta: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-light-hairline pt-6 mt-6 first:mt-0 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 text-left"
      >
        <span
          className={
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] transition-colors ' +
            (completa
              ? 'bg-primary/10 text-primary-deep'
              : aberta
                ? 'text-primary-deep'
                : 'text-base/30')
          }
        >
          {completa ? '✓' : numero}
        </span>
        <span className="flex-1 min-w-0">
          <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 block">
            {titulo}
          </span>
          {!aberta && completa && resumo && (
            <span className="font-mono text-xs text-base/50 block mt-0.5 truncate">
              {resumo}
            </span>
          )}
        </span>
        <ChevronIcon aberto={aberta} />
      </button>
      {aberta && <div className="mt-5 pl-10">{children}</div>}
    </div>
  );
}

function WizardInner() {
  const router = useRouter();
  const params = useSearchParams();
  const pessoa = usePessoa();
  const { getAccessToken } = useAppPrivy();
  // Não-logado → /entrar?next=/vender. O LoginPanel embutido abaixo permanece
  // como fallback defensivo na janela curta antes do redirect.
  useRequireAuth();

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
  const [prazoRestanteMeses, setPrazoRestanteMeses] = useState(
    params.get('prazoRestanteMeses') || '',
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
      const prazo = Number(prazoRestanteMeses);
      const res = await fetch('/api/vender/simular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipoBem,
          valorCarta,
          administradora,
          prazoRestanteMeses: prazo > 0 ? prazo : undefined,
        }),
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
      // getAccessToken() do Privy pode nunca resolver (mesma classe de bug
      // do "Verificando acesso" travado — ver PessoaProvider.refresh()).
      const token = await withTimeout(
        getAccessToken(),
        8000,
        'Sessão demorou pra responder. Tente novamente.',
      );
      // withTimeout (não AbortController): o fetch pode ficar pendurado
      // dentro do desafio do BotID (window.fetch patcheado) sem nunca
      // chegar a respeitar um AbortSignal — ver lib/http/client.ts.
      const res = await withTimeout(
        fetch('/api/vender/lead', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ consentimentoLgpd: true, origem: 'wizard-vender' }),
        }),
        10000,
        'A requisição demorou demais. Tente novamente.',
      );
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
                prazoRestanteMeses={prazoRestanteMeses}
                setPrazoRestanteMeses={setPrazoRestanteMeses}
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
  const [cpfDigits, setCpfDigits] = useState('');
  const [telefoneDigits, setTelefoneDigits] = useState('');
  const [occupation, setOccupation] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [rua, setRua] = useState('');
  const [cidade, setCidade] = useState('');
  const [estado, setEstado] = useState('');
  const [cepDigits, setCepDigits] = useState('');
  const [cepStatus, setCepStatus] = useState<'idle' | 'buscando' | 'valido' | 'invalido' | 'erro'>(
    'idle',
  );
  // Rastreia o último logradouro preenchido automaticamente — permite
  // sobrescrever numa nova busca sem apagar edição manual do usuário (ex.:
  // ele completou com número/complemento depois do autopreenchimento).
  const ruaAutoPreenchida = useRef('');
  const [street2, setStreet2] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [motherMaidenName, setMotherMaidenName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [useEmailForMarketing, setUseEmailForMarketing] = useState(false);
  const [idFront, setIdFront] = useState<string | null>(null);
  const [idBack, setIdBack] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [processandoImagem, setProcessandoImagem] = useState<
    'idFront' | 'idBack' | 'selfie' | null
  >(null);
  const [pixKeyType, setPixKeyType] = useState<'cpf' | 'email' | 'phone' | 'random'>('cpf');
  // Chave Pix real (padrão BACEN): telefone é E.164 (+55...), máscara só de
  // exibição — `pixKeyDigits` guarda os dígitos crus pro tipo `phone`;
  // `pixKey` é texto livre pra email/EVP. CPF NÃO tem estado próprio: uma
  // chave Pix tipo CPF só pode pertencer ao dono da conta, então é sempre
  // `cpfDigits` (a mesma da seção Identidade) — nunca um valor independente.
  const [pixKeyDigits, setPixKeyDigits] = useState('');
  const [pixKey, setPixKey] = useState('');

  function pixKeyValor(): string {
    if (pixKeyType === 'cpf') return cpfDigits;
    if (pixKeyType === 'phone') return pixKeyDigits ? `+55${pixKeyDigits}` : '';
    return pixKey.trim();
  }
  function pixKeyResumo(): string | undefined {
    if (pixKeyType === 'cpf' && cpfDigits) return `CPF · ${maskCpf(cpfDigits)} (mesmo da Identidade)`;
    if (pixKeyType === 'phone' && pixKeyDigits) return `Telefone · ${maskTelefoneBR(pixKeyDigits)}`;
    if (pixKey.trim()) {
      return `${PIX_TIPOS.find((t) => t.v === pixKeyType)?.label} · ${pixKey.trim()}`;
    }
    return undefined;
  }
  const [consentimento, setConsentimento] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function onImagemSelecionada(
    campo: 'idFront' | 'idBack' | 'selfie',
    setter: (v: string | null) => void,
    file: File | undefined,
  ) {
    if (!file) return;
    setProcessandoImagem(campo);
    setErro(null);
    try {
      setter(await compressImageToDataUrl(file));
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessandoImagem(null);
    }
  }

  // Busca/valida o CEP via ViaCEP (público, sem chave) assim que completa 8
  // dígitos: autopreenche rua/cidade/estado e bloqueia avanço se o CEP não
  // existir. Falha de rede não bloqueia (não dá pra confirmar nem invalidar).
  useEffect(() => {
    if (cepDigits.length !== 8) {
      setCepStatus('idle');
      return;
    }
    let cancelado = false;
    setCepStatus('buscando');
    fetch(`https://viacep.com.br/ws/${cepDigits}/json/`)
      .then((res) => res.json())
      .then(
        (data: {
          erro?: boolean;
          logradouro?: string;
          localidade?: string;
          uf?: string;
        }) => {
          if (cancelado) return;
          if (data.erro) {
            setCepStatus('invalido');
            return;
          }
          setCepStatus('valido');
          if (data.localidade) setCidade(data.localidade);
          if (data.uf) setEstado(data.uf);
          if (data.logradouro && (rua.trim() === '' || rua === ruaAutoPreenchida.current)) {
            setRua(data.logradouro);
            ruaAutoPreenchida.current = data.logradouro;
          }
        },
      )
      .catch(() => {
        if (!cancelado) setCepStatus('erro');
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cepDigits]);

  const documentosCompletos = !!idFront && !!idBack && !!selfie;

  // ── Progresso por seção — dirige numeral/ponto/check e o colapso automático
  const nomeTemSobrenome = nome.trim().split(/\s+/).filter(Boolean).length >= 2;
  const identidadeCompleta = !!(
    nome.trim() &&
    nomeTemSobrenome &&
    parseCpf(cpfDigits) &&
    telefoneDigits.length >= 10 &&
    occupation.trim() &&
    dataNascimento.trim() &&
    isMaiorDeIdade(dataNascimento)
  );
  const enderecoCompleto = !!(
    rua.trim() &&
    cidade.trim() &&
    estado.trim() &&
    isUfValida(estado) &&
    cepDigits.length === 8 &&
    cepStatus !== 'invalido' &&
    cepStatus !== 'buscando'
  );
  const documentoCompleto = !KYC_IS_PRODUCTION || documentosCompletos;
  const pixCompleto =
    pixKeyType === 'cpf'
      ? !!parseCpf(cpfDigits)
      : pixKeyType === 'phone'
        ? pixKeyDigits.length >= 10
        : !!pixKey.trim();

  const [abertas, setAbertas] = useState<Record<SecaoId, boolean>>({
    identidade: true,
    endereco: false,
    documento: false,
    pix: false,
  });
  const manualToggle = useRef<Record<SecaoId, boolean>>({
    identidade: false,
    endereco: false,
    documento: false,
    pix: false,
  });
  function toggleSecao(id: SecaoId) {
    manualToggle.current[id] = true;
    setAbertas((a) => ({ ...a, [id]: !a[id] }));
  }
  // Ao completar uma seção (que o usuário não reabriu manualmente antes),
  // colapsa ela e abre a próxima — guia o fluxo sem travar navegação livre.
  useAutoAvancoSecao(identidadeCompleta, 'identidade', 'endereco', setAbertas, manualToggle);
  useAutoAvancoSecao(enderecoCompleto, 'endereco', 'documento', setAbertas, manualToggle);
  useAutoAvancoSecao(documentoCompleto, 'documento', 'pix', setAbertas, manualToggle);

  const valido =
    identidadeCompleta && enderecoCompleto && documentoCompleto && pixCompleto && consentimento;

  async function submit() {
    setLoading(true);
    setErro(null);
    try {
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
          // BR sem DDI na UI — normaliza pra E.164 só aqui no submit.
          telefone: `+55${telefoneDigits}`,
          occupation: occupation.trim(),
          dataNascimento: dataNascimento.trim(),
          endereco: {
            rua: rua.trim(),
            cidade: cidade.trim(),
            estado: estado.trim(),
            cep: cepDigits,
            ...(KYC_IS_PRODUCTION && street2.trim() ? { street2: street2.trim() } : {}),
          },
          // Campos opcionais Etherfuse — só fazem sentido em produção; em
          // sandbox nem aparecem na UI (ver KYC_IS_PRODUCTION), então nunca
          // são enviados com valor de qualquer forma.
          ...(KYC_IS_PRODUCTION && middleName.trim() ? { middleName: middleName.trim() } : {}),
          ...(KYC_IS_PRODUCTION && motherMaidenName.trim()
            ? { motherMaidenName: motherMaidenName.trim() }
            : {}),
          ...(KYC_IS_PRODUCTION && preferredName.trim()
            ? { preferredName: preferredName.trim() }
            : {}),
          ...(KYC_IS_PRODUCTION ? { useEmailForMarketing } : {}),
          ...(documentosCompletos ? { documentos: { idFront, idBack, selfie } } : {}),
          bankAccount: {
            pixKey: pixKeyValor(),
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

      <div className="mt-8">
        <Secao
          numero="01"
          titulo="Identidade"
          completa={identidadeCompleta}
          resumo={nome.trim() ? `${nome.trim()} · CPF ${maskCpf(cpfDigits)}` : undefined}
          aberta={abertas.identidade}
          onToggle={() => toggleSecao('identidade')}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nome completo" required>
              <input
                type="text"
                required
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className={inputClass}
              />
              {nome.trim() && !nomeTemSobrenome && (
                <p className="font-mono text-[10px] text-red-700 mt-1.5">
                  Informe nome e sobrenome.
                </p>
              )}
            </Field>
            <Field label="CPF" required>
              <input
                type="text"
                inputMode="numeric"
                required
                value={maskCpf(cpfDigits)}
                onChange={(e) => setCpfDigits(onlyDigits(e.target.value, 11))}
                placeholder="000.000.000-00"
                className={inputClass + ' font-mono'}
              />
              {cpfDigits.length === 11 && !parseCpf(cpfDigits) && (
                <p className="font-mono text-[10px] text-red-700 mt-1.5">
                  CPF inválido.
                </p>
              )}
            </Field>
          </div>

          {KYC_IS_PRODUCTION && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Nome do meio (opcional)">
                <input
                  type="text"
                  value={middleName}
                  onChange={(e) => setMiddleName(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Sobrenome de solteira da mãe (opcional)">
                <input
                  type="text"
                  value={motherMaidenName}
                  onChange={(e) => setMotherMaidenName(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Nome preferido (opcional)">
                <input
                  type="text"
                  value={preferredName}
                  onChange={(e) => setPreferredName(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Telefone" required>
              <input
                type="tel"
                inputMode="numeric"
                required
                value={maskTelefoneBR(telefoneDigits)}
                onChange={(e) => setTelefoneDigits(onlyDigits(e.target.value, 11))}
                placeholder="(11) 99999-9999"
                className={inputClass + ' font-mono'}
              />
            </Field>
            <Field label="Ocupação" required>
              <input
                type="text"
                required
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
                placeholder="Ex: Engenheiro(a)"
                className={inputClass}
              />
            </Field>
            <Field label="Data de nascimento" required>
              <input
                type="date"
                required
                max={dataMaximaNascimentoISO()}
                value={dataNascimento}
                onChange={(e) => setDataNascimento(e.target.value)}
                className={inputClass + ' font-mono'}
              />
              {dataNascimento.trim() && !isMaiorDeIdade(dataNascimento) && (
                <p className="font-mono text-[10px] text-red-700 mt-1.5">
                  É preciso ser maior de 18 anos.
                </p>
              )}
            </Field>
          </div>
        </Secao>

        <Secao
          numero="02"
          titulo="Endereço residencial"
          completa={enderecoCompleto}
          resumo={rua.trim() ? `${rua.trim()}, ${cidade.trim()} · ${estado.trim()}` : undefined}
          aberta={abertas.endereco}
          onToggle={() => toggleSecao('endereco')}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Rua e número" required>
              <input
                type="text"
                required
                value={rua}
                onChange={(e) => setRua(e.target.value)}
                placeholder="Av. Faria Lima, 1000"
                className={inputClass}
              />
            </Field>
            <Field label="Cidade" required>
              <input
                type="text"
                required
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_160px] gap-4">
            <Field label="Estado (UF)" required>
              <input
                type="text"
                inputMode="text"
                maxLength={2}
                required
                value={estado}
                onChange={(e) => setEstado(e.target.value.toUpperCase().slice(0, 2))}
                placeholder="SP"
                className={inputClass + ' font-mono uppercase'}
              />
              {estado.trim().length === 2 && !isUfValida(estado) && (
                <p className="font-mono text-[10px] text-red-700 mt-1.5">UF inválida.</p>
              )}
            </Field>
            <Field label="CEP" required>
              <input
                type="text"
                inputMode="numeric"
                required
                value={maskCep(cepDigits)}
                onChange={(e) => setCepDigits(onlyDigits(e.target.value, 8))}
                placeholder="00000-000"
                className={inputClass + ' font-mono'}
              />
              {cepStatus === 'buscando' && (
                <p className="font-mono text-[10px] text-base/50 mt-1.5">
                  Buscando endereço…
                </p>
              )}
              {cepStatus === 'invalido' && (
                <p className="font-mono text-[10px] text-red-700 mt-1.5">
                  CEP não encontrado — confira o número.
                </p>
              )}
              {cepStatus === 'erro' && (
                <p className="font-mono text-[10px] text-base/50 mt-1.5">
                  Não foi possível validar agora — confira o endereço.
                </p>
              )}
              {cepStatus === 'valido' && (
                <p className="font-mono text-[10px] text-primary-deep mt-1.5">
                  ✓ Rua e cidade preenchidas automaticamente
                </p>
              )}
            </Field>
          </div>
          {KYC_IS_PRODUCTION && (
            <div className="mt-4">
              <Field label="Complemento (opcional)">
                <input
                  type="text"
                  value={street2}
                  onChange={(e) => setStreet2(e.target.value)}
                  placeholder="Apto, bloco, etc."
                  className={inputClass}
                />
              </Field>
            </div>
          )}
        </Secao>

        <Secao
          numero="03"
          titulo="Documento e selfie"
          completa={documentoCompleto}
          resumo={
            documentosCompletos
              ? 'Frente, verso e selfie enviados'
              : !KYC_IS_PRODUCTION
                ? 'Opcional em sandbox'
                : undefined
          }
          aberta={abertas.documento}
          onToggle={() => toggleSecao('documento')}
        >
          <p className="font-text text-sm text-base/60 -mt-1 mb-4">
            Fotos usadas só pra verificação de identidade (SEP-12) —
            processadas pelo parceiro de KYC, não armazenadas por nós.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ImagemField
              label="Documento (frente)"
              instrucao="Sem reflexo, cantos visíveis."
              required={KYC_IS_PRODUCTION}
              aspecto="documento"
              capture="environment"
              value={idFront}
              processando={processandoImagem === 'idFront'}
              onChange={(file) => onImagemSelecionada('idFront', setIdFront, file)}
            />
            <ImagemField
              label="Documento (verso)"
              instrucao="Mesmos cuidados do verso."
              required={KYC_IS_PRODUCTION}
              aspecto="documento"
              capture="environment"
              value={idBack}
              processando={processandoImagem === 'idBack'}
              onChange={(file) => onImagemSelecionada('idBack', setIdBack, file)}
            />
            <ImagemField
              label="Selfie"
              instrucao="Rosto centralizado, boa luz."
              required={KYC_IS_PRODUCTION}
              aspecto="selfie"
              capture="user"
              value={selfie}
              processando={processandoImagem === 'selfie'}
              onChange={(file) => onImagemSelecionada('selfie', setSelfie, file)}
            />
          </div>
        </Secao>

        <Secao
          numero="04"
          titulo="Conta para receber o Pix"
          completa={pixCompleto}
          resumo={pixKeyResumo()}
          aberta={abertas.pix}
          onToggle={() => toggleSecao('pix')}
        >
          <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4">
            <Field label="Tipo de chave">
              <select
                value={pixKeyType}
                onChange={(e) => {
                  // Troca de tipo invalida a chave anterior — evita enviar
                  // dígitos de CPF como se fossem telefone (ou vice-versa).
                  setPixKeyDigits('');
                  setPixKey('');
                  setPixKeyType(e.target.value as typeof pixKeyType);
                }}
                className={inputClass}
              >
                {PIX_TIPOS.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            {pixKeyType === 'cpf' ? (
              <Field label="Chave Pix (CPF)">
                <input
                  type="text"
                  readOnly
                  disabled
                  value={cpfDigits ? maskCpf(cpfDigits) : ''}
                  placeholder="preencha o CPF na seção Identidade"
                  className={inputClass + ' font-mono bg-document-grey/40 cursor-not-allowed'}
                />
                <p className="font-mono text-[10px] text-base/50 mt-1.5">
                  Uma chave Pix CPF só pode ser do dono da conta — usamos o
                  mesmo CPF da seção Identidade.
                </p>
              </Field>
            ) : pixKeyType === 'phone' ? (
              <Field label="Chave Pix (telefone)">
                <input
                  type="tel"
                  inputMode="numeric"
                  value={maskTelefoneBR(pixKeyDigits)}
                  onChange={(e) => setPixKeyDigits(onlyDigits(e.target.value, 11))}
                  placeholder="(11) 99999-9999"
                  className={inputClass + ' font-mono'}
                />
              </Field>
            ) : pixKeyType === 'email' ? (
              <Field label="Chave Pix (e-mail)">
                <input
                  type="email"
                  value={pixKey}
                  onChange={(e) => setPixKey(e.target.value)}
                  className={inputClass}
                />
              </Field>
            ) : (
              <Field label="Chave Pix (aleatória)">
                <input
                  type="text"
                  value={pixKey}
                  onChange={(e) => setPixKey(e.target.value)}
                  placeholder="UUID gerado pelo seu banco"
                  className={inputClass + ' font-mono'}
                />
              </Field>
            )}
          </div>
        </Secao>
      </div>

      <div className="mt-6">
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

      {KYC_IS_PRODUCTION && (
        <label className="flex items-start gap-3 cursor-pointer mt-3">
          <input
            type="checkbox"
            checked={useEmailForMarketing}
            onChange={(e) => setUseEmailForMarketing(e.target.checked)}
            className="mt-1.5 w-4 h-4 accent-primary"
          />
          <span className="font-text text-sm text-base/75 leading-relaxed">
            Aceito receber e-mails sobre novidades e oportunidades da Plina
            (opcional, base legal separada do consentimento acima).
          </span>
        </label>
      )}

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
  prazoRestanteMeses: string;
  setPrazoRestanteMeses: (v: string) => void;
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

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Prazo restante (meses, opcional)">
          <input
            type="number"
            min="1"
            max="600"
            step="1"
            value={props.prazoRestanteMeses}
            onChange={(e) => props.setPrazoRestanteMeses(e.target.value)}
            placeholder="Ex: 24"
            className={inputClass + ' font-mono'}
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

/** Input de arquivo pra foto de documento/selfie. `capture` sugere câmera
 *  traseira (`environment`, doc) ou frontal (`user`, selfie) no mobile; no
 *  desktop cai no seletor de arquivo normal. Compressão acontece no `onChange`
 *  do caller (`compressImageToDataUrl`), aqui só mostra estado/preview. */
/** Input de arquivo pra foto de documento/selfie. `capture` sugere câmera
 *  traseira (`environment`, doc) ou frontal (`user`, selfie) no mobile; no
 *  desktop cai no seletor de arquivo normal. Enquanto vazio, mostra uma
 *  moldura-guia tracejada na proporção do tipo (documento ~cartão, selfie
 *  retrato) — sinaliza enquadramento esperado antes da primeira foto.
 *  Compressão acontece no `onChange` do caller (`compressImageToDataUrl`). */
function ImagemField({
  label,
  instrucao,
  required,
  aspecto,
  capture,
  value,
  processando,
  onChange,
}: {
  label: string;
  instrucao: string;
  required?: boolean;
  aspecto: 'documento' | 'selfie';
  capture: 'environment' | 'user';
  value: string | null;
  processando: boolean;
  onChange: (file: File | undefined) => void;
}) {
  const aspectClass = aspecto === 'documento' ? 'aspect-[8/5]' : 'aspect-[3/4]';
  return (
    <Field label={label} required={required}>
      <div className="mt-2 border border-light-hairline bg-white p-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={label}
            className={`w-full ${aspectClass} object-cover mb-2`}
          />
        ) : (
          <div
            className={`w-full ${aspectClass} mb-2 bg-document-grey/30 flex items-center justify-center p-2`}
          >
            <div className="w-full h-full border border-dashed border-base/25 flex items-center justify-center px-2">
              <span className="font-mono text-[10px] text-base/40 text-center leading-snug">
                {instrucao}
              </span>
            </div>
          </div>
        )}
        <input
          type="file"
          accept="image/*"
          capture={capture}
          onChange={(e) => onChange(e.target.files?.[0])}
          disabled={processando}
          className="w-full font-text text-xs"
        />
        {processando && (
          <p className="font-mono text-[10px] text-base/50 mt-1">processando…</p>
        )}
      </div>
    </Field>
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
