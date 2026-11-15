/** Aviso no topo do acompanhamento quando "Enviar e acompanhar" reaproveitou a solicitação aberta (A-11). */
export default function AvisoSolicitacao({ aviso }: { aviso: string | undefined }) {
  if (aviso !== 'reaproveitada') return null;
  return (
    <p role="status" data-testid="aviso-reaproveitada" className="mb-8 border border-base/40 bg-document-grey/60 px-4 py-3 font-text text-sm text-base">
      Você já tem uma solicitação aberta; abrimos a mesma.
    </p>
  );
}
