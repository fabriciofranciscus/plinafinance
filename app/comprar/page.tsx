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
import { PHASES, phaseForScreen, screenLabel } from './_lib/glossary';
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
  // O erro fica junto da ação que o gerou (AP-5 C4): a tela ativa recebe o bloco e o renderiza logo abaixo do botão.
  const erro = flow.error ? <ErrorBlock error={flow.error} onDismiss={flow.dismissError} /> : null;

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
              {phase && phase.screens.length > 1 && <> · {screenLabel(screen)}</>}
            </span>
          </div>
          <button
            onClick={() => logout()}
            className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 hover:text-base max-md:inline-flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center"
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
                  falhou={flow.cotas.falhou}
                  erro={erro}
                  onSelect={flow.onSelectCota}
                />
              )}
              {screen === 'diligencia' && (
                <DiligenciaScreen
                  selectedCota={flow.selectedCota}
                  data={flow.diligencia.diligencia}
                  loading={flow.diligencia.loading}
                  onContinue={flow.onDiligenciaContinue}
                  erro={erro}
                />
              )}
              {screen === 'proposta' && (
                <PropostaScreen
                  cota={flow.selectedCota}
                  loading={flow.reserva.loading}
                  onAceitar={flow.onAceitarProposta}
                  erro={erro}
                />
              )}
              {screen === 'kyc' && (
                <KycScreen
                  pessoa={flow.pessoa}
                  cota={flow.selectedCota}
                  reserva={flow.reserva.reserva}
                  loading={flow.kyc.loading}
                  onSubmit={flow.onKycSubmit}
                  erro={erro}
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
                  erro={erro}
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
                  erro={erro}
                />
              )}
            </ScreenFader>

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
