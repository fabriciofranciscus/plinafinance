'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import SectionMarker from './SectionMarker';
import { submitLead, type LeadState } from '@/app/actions/submit-lead';
import type { Dictionary } from '@/lib/i18n/types';

const initialState: LeadState = { status: 'idle' };

const inputBaseClass =
  'w-full px-7 py-4 rounded-full border border-light-hairline font-text text-base focus:outline-none focus-visible:border-primary-deep focus-visible:ring-2 focus-visible:ring-primary-deep/20 bg-lightBg/30 transition-colors';

const labelBaseClass =
  'font-details text-[11px] uppercase font-bold text-base/60 ml-4 block';

type Props = { dict: Dictionary['leadCapture'] };

export default function LeadCaptureSection({ dict }: Props) {
  const [state, formAction, pending] = useActionState(submitLead, initialState);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

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
          <SectionMarker num={dict.numMarker} label={dict.marker} />
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
            {(state.status === 'success' ? dict.headingSuccess : dict.headingIdle).map(
              (linha, i) => (
                <span key={i}>
                  {linha}
                  {i === 0 && <br />}
                </span>
              )
            )}
          </h2>
          <p className="lg:col-span-4 font-text text-base/70 text-lg font-light leading-relaxed">
            {state.status === 'success' ? dict.subSuccess : dict.subIdle}
          </p>
        </div>

        {state.status === 'success' ? (
          <SuccessPanel dict={dict.successPanel} />
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

            {/* Linha 1: nome + organização */}
            <fieldset
              disabled={pending}
              className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-6 mb-6 border-0 p-0"
            >
              <legend className="sr-only">{dict.fields.nome}</legend>

              <div className="space-y-1.5">
                <label htmlFor="lc-name" className={labelBaseClass}>
                  {dict.fields.nome}
                </label>
                <input
                  id="lc-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder={dict.fields.nomePlaceholder}
                  required
                  className={inputBaseClass}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="lc-org" className={labelBaseClass}>
                  {dict.fields.org}
                </label>
                <input
                  id="lc-org"
                  name="org"
                  type="text"
                  autoComplete="organization"
                  placeholder={dict.fields.orgPlaceholder}
                  required
                  className={inputBaseClass}
                />
              </div>
            </fieldset>

            {/* Linha 2: email + telefone */}
            <fieldset
              disabled={pending}
              className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-6 mb-6 border-0 p-0"
            >
              <legend className="sr-only">{dict.fields.email}</legend>

              <div className="space-y-1.5">
                <label htmlFor="lc-email" className={labelBaseClass}>
                  {dict.fields.email}
                </label>
                <input
                  id="lc-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder={dict.fields.emailPlaceholder}
                  required
                  className={inputBaseClass}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="lc-phone" className={labelBaseClass}>
                  {dict.fields.telefone}
                </label>
                <input
                  id="lc-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder={dict.fields.telefonePlaceholder}
                  className={inputBaseClass}
                />
              </div>
            </fieldset>

            {/* Linha 3: perfil + jurisdição */}
            <fieldset
              disabled={pending}
              className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-6 mb-6 border-0 p-0"
            >
              <legend className="sr-only">{dict.fields.perfil}</legend>

              <div className="space-y-1.5">
                <label htmlFor="lc-profile" className={labelBaseClass}>
                  {dict.fields.perfil}
                </label>
                <SelectField id="lc-profile" name="profile" required selectLabel={dict.fields.selecione}>
                  {Object.entries(dict.selectOptions.profile).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </SelectField>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="lc-jurisdiction" className={labelBaseClass}>
                  {dict.fields.jurisdicao}
                </label>
                <input
                  id="lc-jurisdiction"
                  name="jurisdiction"
                  type="text"
                  placeholder={dict.fields.jurisdicaoPlaceholder}
                  className={inputBaseClass}
                />
              </div>
            </fieldset>

            {/* Linha 4: tíquete + moeda */}
            <fieldset
              disabled={pending}
              className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-6 mb-6 border-0 p-0"
            >
              <legend className="sr-only">{dict.fields.ticket}</legend>

              <div className="space-y-1.5">
                <label htmlFor="lc-ticket" className={labelBaseClass}>
                  {dict.fields.ticket}
                </label>
                <SelectField id="lc-ticket" name="ticket" required selectLabel={dict.fields.selecione}>
                  {Object.entries(dict.selectOptions.ticket).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </SelectField>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="lc-currency" className={labelBaseClass}>
                  {dict.fields.moeda}
                </label>
                <SelectField id="lc-currency" name="currency" required={false} selectLabel={dict.fields.selecioneOpcional}>
                  {Object.entries(dict.selectOptions.currency).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </SelectField>
              </div>
            </fieldset>

            {/* Linha 5: classe + prazo */}
            <fieldset
              disabled={pending}
              className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-6 mb-6 border-0 p-0"
            >
              <legend className="sr-only">{dict.fields.classe}</legend>

              <div className="space-y-1.5">
                <label htmlFor="lc-classe" className={labelBaseClass}>
                  {dict.fields.classe}
                </label>
                <SelectField id="lc-classe" name="classe" required={false} selectLabel={dict.fields.selecioneOpcional}>
                  {Object.entries(dict.selectOptions.classe).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </SelectField>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="lc-timeline" className={labelBaseClass}>
                  {dict.fields.prazo}
                </label>
                <SelectField id="lc-timeline" name="timeline" required={false} selectLabel={dict.fields.selecioneOpcional}>
                  {Object.entries(dict.selectOptions.timeline).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </SelectField>
              </div>
            </fieldset>

            {/* Linha 6: observações */}
            <fieldset
              disabled={pending}
              className="mb-6 border-0 p-0"
            >
              <legend className="sr-only">{dict.fields.observacoes}</legend>
              <div className="space-y-1.5">
                <label htmlFor="lc-notes" className={labelBaseClass}>
                  {dict.fields.observacoes}
                </label>
                <textarea
                  id="lc-notes"
                  name="notes"
                  rows={4}
                  placeholder={dict.fields.observacoesPlaceholder}
                  className={
                    inputBaseClass.replace('rounded-full', 'rounded-2xl') +
                    ' resize-none'
                  }
                />
              </div>
            </fieldset>

            {/* LGPD */}
            <div className="flex items-start gap-3 mb-8">
              <input
                type="checkbox"
                id="lc-lgpd"
                name="lgpd"
                required
                className="mt-1 w-4 h-4 accent-primary-deep flex-shrink-0 cursor-pointer"
              />
              <label htmlFor="lc-lgpd" className="font-text text-sm text-base/60 leading-relaxed cursor-pointer">
                {dict.lgpdNotice}
              </label>
            </div>

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
              {pending ? dict.submitPending : dict.submitIdle}
            </button>
          </form>
        )}

        <p className="font-details text-[10px] uppercase tracking-widest text-base/60 mt-8">
          {dict.footerNote}
        </p>
      </div>
    </section>
  );
}

function SelectField({
  id,
  name,
  required = true,
  selectLabel,
  children,
}: {
  id: string;
  name: string;
  required?: boolean;
  selectLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        name={name}
        required={required}
        defaultValue=""
        className={inputBaseClass + ' appearance-none pr-12'}
      >
        {required && <option value="" disabled>{selectLabel}</option>}
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

function SuccessPanel({ dict }: { dict: Dictionary['leadCapture']['successPanel'] }) {
  return (
    <div role="status" aria-live="polite" className="text-left max-w-3xl mx-auto">
      <div className="flex items-center gap-4 justify-center mb-12">
        <span className="w-12 h-12 rounded-full bg-primary-deep/10 flex items-center justify-center">
          <Check className="w-6 h-6 text-primary-deep" aria-hidden />
        </span>
        <span className="font-mono text-xs text-primary-deep uppercase tracking-widest">
          {dict.protocolo} · {new Date().toISOString().slice(0, 10).replace(/-/g, '')}
        </span>
      </div>

      <div className="border-t border-light-hairline">
        {dict.passos.map((p) => (
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
        {dict.duvidas} <a href="mailto:contato@plina.finance" className="text-primary-deep underline-offset-4 hover:underline">contato@plina.finance</a>
      </p>
    </div>
  );
}
