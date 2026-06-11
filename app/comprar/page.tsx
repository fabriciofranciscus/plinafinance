'use client';

/**
 * /comprar — wizard de compra de cota (fluxo oficial do mockup, 5 passos):
 * buscar → diligencia → proposta → (kyc → cessao) → confirmacao.
 *
 * Espelha a arquitetura de /investir: shell de orquestração + Rail (stepper) +
 * ScreenFader, com o estado/composição de hooks em `_hooks/use-comprar-flow.ts`.
 * Protegido por useRequireAuth (login Privy obrigatório).
 */

import { useAppLogout as useLogout } from '@/lib/hooks/privy';
import { useRequireAuth } from '@/lib/hooks/use-require-auth';
import { PHASES, phaseForScreen } from './_lib/glossary';
import { useComprarFlow } from './_hooks/use-comprar-flow';
import { Rail } from './_components/shell/rail';
import { ScreenFader } from '@/app/investir/_components/shell/screen-fader';
import { ErrorBlock } from '@/app/investir/_components/shell/error-block';
import { BuscarScreen } from './_components/screens/buscar';
import { DiligenciaScreen } from './_components/screens/diligencia';
import { PropostaScreen } from './_components/screens/proposta';
import { KycScreen } from './_components/screens/kyc';
import { CessaoScreen } from './_components/screens/cessao';
import { ConfirmacaoScreen } from './_components/screens/confirmacao';

export default function ComprarPage() {
  const flow = useComprarFlow();
  const { logout } = useLogout();
  const { checking, authenticated } = useRequireAuth();

  if (checking || !authenticated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 animate-pulse">
          Verificando acesso…
        </p>
      </div>
    );
  }

  const { screen } = flow;
  const { phase, index: phaseIdx } = phaseForScreen(screen);

  return (
    <div className="bg-lightBg min-h-screen">
      <div className="mx-auto max-w-6xl grid grid-cols-1 md:grid-cols-[260px_1fr] md:gap-px md:bg-base/10">
        <aside className="hidden md:block bg-lightBg sticky top-0 self-start h-screen">
          <Rail current={screen} />
        </aside>

        <div className="md:hidden bg-lightBg border-b border-light-hairline px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-primary-deep">
              {String(phaseIdx + 1).padStart(2, '0')} /{' '}
              {String(PHASES.length).padStart(2, '0')}
            </span>
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base">
              {phase?.label}
            </span>
          </div>
          <button
            onClick={() => logout()}
            className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 hover:text-base"
          >
            Sair
          </button>
        </div>

        <main className="bg-white min-h-screen relative">
          <div className="px-6 py-12 md:px-16 md:py-20 max-w-2xl">
            {flow.canGoBack && (
              <button
                onClick={flow.goBack}
                className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 hover:text-base mb-10 transition-colors"
              >
                ← Voltar
              </button>
            )}

            <ScreenFader key={screen}>
              {screen === 'buscar' && (
                <BuscarScreen
                  cotas={flow.cotas.cotas}
                  loading={flow.cotas.loading}
                  onSelect={flow.onSelectCota}
                />
              )}
              {screen === 'diligencia' && (
                <DiligenciaScreen
                  selectedCota={flow.selectedCota}
                  data={flow.diligencia.diligencia}
                  loading={flow.diligencia.loading}
                  onContinue={flow.onDiligenciaContinue}
                />
              )}
              {screen === 'proposta' && (
                <PropostaScreen
                  cota={flow.selectedCota}
                  loading={flow.reserva.loading}
                  onAceitar={flow.onAceitarProposta}
                />
              )}
              {screen === 'kyc' && (
                <KycScreen
                  pessoa={flow.pessoa}
                  loading={flow.kyc.loading}
                  onSubmit={flow.onKycSubmit}
                />
              )}
              {screen === 'cessao' && (
                <CessaoScreen
                  pessoa={flow.pessoa}
                  cota={flow.selectedCota}
                  reserva={flow.reserva.reserva}
                  cessao={flow.cessao.cessao}
                  signing={flow.cessao.signing}
                  onAssinar={flow.onAssinarCessao}
                />
              )}
              {screen === 'confirmacao' && (
                <ConfirmacaoScreen
                  cota={flow.selectedCota}
                  reserva={flow.reserva.reserva}
                  cessao={flow.cessao.cessao}
                  confirmacao={flow.cessao.confirmacao}
                  confirming={flow.cessao.confirming}
                  onConfirmar={flow.onConfirmar}
                />
              )}
            </ScreenFader>

            {flow.error && (
              <ErrorBlock error={flow.error} onDismiss={flow.dismissError} />
            )}

            {screen !== 'confirmacao' && (
              <div className="hidden md:block mt-20 pt-8 border-t border-light-hairline">
                <button
                  onClick={() => logout()}
                  className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 hover:text-base transition-colors"
                >
                  Sair da sessão
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
