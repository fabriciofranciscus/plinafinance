'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import SectionMarker from './SectionMarker';
import { submitLead, type LeadState } from '@/app/actions/submit-lead';

const initialState: LeadState = { status: 'idle' };

function formatCNPJInput(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const inputBaseClass =
  'w-full px-7 py-4 rounded-full border border-light-hairline font-text text-base focus:outline-none focus-visible:border-primary-deep focus-visible:ring-2 focus-visible:ring-primary-deep/20 bg-lightBg/30 transition-colors';

const labelBaseClass =
  'font-details text-[11px] uppercase font-bold text-base/60 ml-4 block';

export default function LeadCaptureSection() {
  const [state, formAction, pending] = useActionState(submitLead, initialState);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Quando muda pra success ou error, garante que o conteúdo está visível
  // (bypass do reveal opacity:0 caso o IntersectionObserver não tenha disparado)
  // e rola pra seção pra a mensagem ficar à vista.
  useEffect(() => {
    if (state.status !== 'idle') {
      wrapperRef.current?.classList.add('active');
      document
        .getElementById('lead-capture')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [state.status]);

  return (
    <section id="lead-capture" className="py-32 bg-white">
      <div ref={wrapperRef} className="max-w-[1400px] mx-auto px-6 reveal">
        <div className="flex items-start justify-between mb-16">
          <SectionMarker num="06" label="Onboarding" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-8 gap-y-12 items-end mb-16">
          <h2
            className="lg:col-span-8 font-title font-semibold text-base"
            style={{
              fontSize: 'clamp(3rem, 8.5vw, 7rem)',
              lineHeight: 0.95,
              letterSpacing: '-0.04em',
            }}
          >
            {state.status === 'success' ? (
              <>
                Aplicação<br />recebida.
              </>
            ) : (
              <>
                Solicite o<br />Prospecto.
              </>
            )}
          </h2>
          <p className="lg:col-span-4 font-text text-base/70 text-lg font-light leading-relaxed">
            {state.status === 'success'
              ? 'Nossa equipe de Relações com Investidores entrará em contato em até 2 dias úteis com Prospecto, regulamento do FIDC e cronograma de Due Diligence.'
              : 'Solicite acesso ao Prospecto e à próxima janela de captação. Nossa equipe de Relações com Investidores entrará em contato com a documentação de habilitação institucional.'}
          </p>
        </div>

        {state.status === 'success' ? (
          <SuccessPanel />
        ) : (
          <form
            action={formAction}
            className="max-w-4xl"
            aria-busy={pending}
          >
            {/* Honeypot — campo invisível pra filtrar bots. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              style={{
                position: 'absolute',
                width: '1px',
                height: '1px',
                opacity: 0,
                pointerEvents: 'none',
              }}
            />

            <fieldset
              disabled={pending}
              className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-6 mb-10 border-0 p-0"
            >
              <legend className="sr-only">Identificação do Responsável</legend>

              <div className="space-y-1.5">
                <label htmlFor="lc-nome" className={labelBaseClass}>
                  Responsável Corporativo
                </label>
                <input
                  id="lc-nome"
                  name="nome"
                  type="text"
                  autoComplete="name"
                  placeholder="Nome Completo"
                  required
                  className={inputBaseClass}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="lc-email" className={labelBaseClass}>
                  E-mail Corporativo
                </label>
                <input
                  id="lc-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="email@instituicao.com"
                  required
                  className={inputBaseClass}
                />
              </div>
            </fieldset>

            <fieldset
              disabled={pending}
              className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-6 mb-10 border-0 p-0"
            >
              <legend className="sr-only">Identificação da Instituição</legend>

              <div className="space-y-1.5">
                <label htmlFor="lc-razao" className={labelBaseClass}>
                  Razão Social
                </label>
                <input
                  id="lc-razao"
                  name="razao"
                  type="text"
                  autoComplete="organization"
                  placeholder="Family Office / Gestora"
                  required
                  className={inputBaseClass}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="lc-cnpj" className={labelBaseClass}>
                  CNPJ
                </label>
                <input
                  id="lc-cnpj"
                  name="cnpj"
                  type="text"
                  inputMode="numeric"
                  placeholder="00.000.000/0001-00"
                  required
                  maxLength={18}
                  onInput={(e) => {
                    e.currentTarget.value = formatCNPJInput(e.currentTarget.value);
                  }}
                  className={inputBaseClass}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="lc-tipo" className={labelBaseClass}>
                  Tipo de Instituição
                </label>
                <SelectField id="lc-tipo" name="tipo">
                  <option>Family Office</option>
                  <option>Gestora Multimercado</option>
                  <option>Custodiante Institucional</option>
                  <option>Parceiro Estratégico</option>
                  <option>Fintech LATAM</option>
                  <option>Outro</option>
                </SelectField>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="lc-aum" className={labelBaseClass}>
                  Ativos sob Gestão (AUM)
                </label>
                <SelectField id="lc-aum" name="aum">
                  <option>Acima de R$ 50M</option>
                  <option>Acima de R$ 100M</option>
                  <option>Acima de R$ 500M</option>
                  <option>Acima de US$ 100M</option>
                </SelectField>
              </div>
            </fieldset>

            {state.status === 'error' && state.message && (
              <p
                role="alert"
                className="font-details text-xs text-red-700 bg-red-50 border border-red-200 rounded-full px-5 py-3 mb-6 text-center"
              >
                {state.message}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full bg-base text-white py-5 font-details text-xs uppercase tracking-[0.2em] font-bold rounded-full hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary transition-[background-color,box-shadow,opacity] duration-300 ease-out shadow-xl hover:shadow-primary/20 disabled:opacity-60 disabled:cursor-wait"
            >
              {pending ? 'Enviando…' : 'Solicitar Prospecto'}
            </button>
          </form>
        )}

        <p className="font-details text-[10px] uppercase tracking-widest text-base/60 mt-8">
          Oferta restrita · Investidor qualificado · Lei 11.795/2008 · CVM 175
        </p>
      </div>
    </section>
  );
}

function SelectField({
  id,
  name,
  children,
}: {
  id: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        name={name}
        required
        className={inputBaseClass + ' appearance-none pr-12'}
      >
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 w-3 h-3 text-base/60"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="5 8 10 13 15 8" />
      </svg>
    </div>
  );
}

function SuccessPanel() {
  const passos = [
    { ordem: '01', titulo: 'Confirmação imediata', detalhe: 'Recebemos sua aplicação e o protocolo foi gerado.' },
    { ordem: '02', titulo: 'Em até 2 dias úteis', detalhe: 'Nossa equipe de RI envia Prospecto, regulamento do FIDC e cronograma de Due Diligence.' },
    { ordem: '03', titulo: 'Roadshow institucional', detalhe: 'Agendamento com o time fundador. Slots em Miami, São Paulo, Cingapura e Londres.' },
  ];

  return (
    <div role="status" aria-live="polite" className="text-left max-w-3xl mx-auto">
      <div className="flex items-center gap-4 justify-center mb-12">
        <span className="w-12 h-12 rounded-full bg-primary-deep/10 flex items-center justify-center">
          <Check className="w-6 h-6 text-primary-deep" aria-hidden />
        </span>
        <span className="font-mono text-xs text-primary-deep uppercase tracking-widest">
          Protocolo · {new Date().toISOString().slice(0, 10).replace(/-/g, '')}
        </span>
      </div>

      <div className="border-t border-light-hairline">
        {passos.map((p) => (
          <div
            key={p.ordem}
            className="border-b border-light-hairline py-8 flex flex-col sm:flex-row gap-4 sm:gap-12 items-start"
          >
            <span className="font-mono text-2xl font-light text-base/30 sm:w-16">{p.ordem}</span>
            <div className="flex-1">
              <h3 className="font-title font-semibold text-xl text-base mb-2 tracking-tight">{p.titulo}</h3>
              <p className="font-text text-base/70 text-base font-light leading-relaxed">{p.detalhe}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="font-details text-[11px] uppercase tracking-widest text-base/60 mt-10 text-center">
        Dúvidas? <a href="mailto:contato@plina.finance" className="text-primary-deep underline-offset-4 hover:underline">contato@plina.finance</a>
      </p>
    </div>
  );
}
