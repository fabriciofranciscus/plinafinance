'use client';

import { useActionState, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { usePessoa } from '@/components/PessoaProvider';
import {
  submitIncident,
  type IncidentState,
} from '@/app/actions/submit-incident';
import type { FlowError } from '../../_types';

const initialState: IncidentState = { status: 'idle' };

const fieldClass =
  'w-full px-4 py-3 border border-light-hairline font-text text-sm text-base bg-lightBg/30 focus:outline-none focus-visible:border-primary-deep focus-visible:ring-2 focus-visible:ring-primary-deep/20 transition-colors';
const labelClass =
  'font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-1.5 block';

export function IncidentReportModal({
  error,
  onClose,
}: {
  error: FlowError;
  onClose: () => void;
}) {
  const pessoa = usePessoa();
  const pathname = usePathname();
  const [state, formAction, pending] = useActionState(
    submitIncident,
    initialState,
  );

  // Prefill editável: nome/e-mail do usuário logado. Controlado pra atualizar
  // se a pessoa carregar depois que o modal abriu.
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  useEffect(() => {
    if (pessoa.nome) setNome((v) => v || pessoa.nome!);
    if (pessoa.email) setEmail((v) => v || pessoa.email!);
  }, [pessoa.nome, pessoa.email]);

  // Fecha no Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const userAgent =
    typeof navigator !== 'undefined' ? navigator.userAgent : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/40 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reportar incidente"
        className="w-full max-w-lg bg-white border border-base/20 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-light-hairline">
          <div className="flex items-center gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-primary-deep" aria-hidden />
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base">
              Reportar incidente
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="text-base/50 hover:text-base transition-colors"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>

        {state.status === 'success' ? (
          <div role="status" aria-live="polite" className="px-5 py-8 text-center">
            <span className="w-12 h-12 rounded-full bg-primary-deep/10 flex items-center justify-center mx-auto mb-4">
              <Check className="w-6 h-6 text-primary-deep" aria-hidden />
            </span>
            <p className="font-text text-sm text-base/85 leading-relaxed">
              Incidente enviado. Nossa equipe vai analisar e responder no e-mail
              informado.
            </p>
            <p className="font-mono text-[10px] text-base/55 tracking-wide mt-2">
              {error.ticketId}
            </p>
            <button
              onClick={onClose}
              className="mt-6 font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep hover:text-base"
            >
              Fechar
            </button>
          </div>
        ) : (
          <form action={formAction} aria-busy={pending} className="px-5 py-5">
            {/* Honeypot */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              aria-hidden
              autoComplete="off"
              className="absolute w-px h-px opacity-0 pointer-events-none -z-10"
            />
            {/* Infos técnicas (auto) */}
            <input type="hidden" name="ticketId" value={error.ticketId} />
            <input type="hidden" name="technical" value={error.technical} />
            <input type="hidden" name="pathname" value={pathname} />
            <input type="hidden" name="userAgent" value={userAgent} />

            <div className="space-y-4">
              <div>
                <label htmlFor="inc-nome" className={labelClass}>
                  Nome
                </label>
                <input
                  id="inc-nome"
                  name="nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required
                  maxLength={200}
                  disabled={pending}
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor="inc-email" className={labelClass}>
                  E-mail para retorno
                </label>
                <input
                  id="inc-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={254}
                  disabled={pending}
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor="inc-msg" className={labelClass}>
                  O que aconteceu? <span className="text-base/40">(opcional)</span>
                </label>
                <textarea
                  id="inc-msg"
                  name="mensagem"
                  rows={4}
                  maxLength={5000}
                  disabled={pending}
                  placeholder="Conte o que você estava fazendo quando o erro apareceu."
                  className={`${fieldClass} resize-y`}
                />
              </div>

              <div>
                <p className={labelClass}>Informações técnicas anexadas</p>
                <pre className="bg-lightBg/60 border border-light-hairline px-4 py-3 font-mono text-[10px] text-base/70 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                  {error.ticketId}
                  {'\n'}
                  {error.technical}
                </pre>
              </div>

              {state.status === 'error' && state.message && (
                <p
                  role="alert"
                  className="font-details text-xs text-red-700 bg-red-50 border border-red-200 px-4 py-3"
                >
                  {state.message}
                </p>
              )}

              <button
                type="submit"
                disabled={pending}
                className="w-full bg-base text-white py-4 font-details text-[11px] uppercase tracking-[0.2em] font-bold hover:bg-primary-deep transition-colors disabled:opacity-60 disabled:cursor-wait"
              >
                {pending ? 'Enviando…' : 'Enviar incidente'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
