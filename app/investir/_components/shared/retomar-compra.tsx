'use client';

import type { FaseOrdemPendente } from '@/lib/services/ordem-pendente';
import type { OrdemPendente } from '../../_types';

/** Frase da Norma (16/11): em testnet o pagamento é SIMULADO; sem ela os textos de pagamento afirmariam um pagamento real. */
export const AVISO_PAGAMENTO_SIMULADO = 'Em rede de testes, o pagamento é simulado.';

/**
 * Textos por fase (U2 A-02), decididos pela Norma (16/11). Só dizem o que o sistema sabe: as fases de pagamento levam o aviso
 * de pagamento simulado; sem prazo vago em "conferência" (mesma regra do saque); o claim é "receber" (o glossário reserva
 * "resgate" à saída de tokens); "em conferência" não tem botão.
 */
export const TEXTO_RETOMADA: Record<FaseOrdemPendente, { titulo: string; texto: string; botao: string | null }> = {
  aguardando_pagamento: {
    titulo: 'Você tem uma compra aguardando o pagamento',
    texto: `Você iniciou uma compra e ainda não concluiu o pagamento. ${AVISO_PAGAMENTO_SIMULADO} Dá para continuar de onde parou.`,
    botao: 'Continuar compra',
  },
  liquidando: {
    titulo: 'Seu pagamento está sendo confirmado',
    texto: 'Recebemos a sua ordem e falta a confirmação do pagamento. Dá para acompanhar de onde parou.',
    botao: 'Acompanhar compra',
  },
  resgatar_tesouro: {
    titulo: 'Falta receber o seu TESOURO',
    texto: `Seu pagamento foi confirmado e o TESOURO está reservado para você. Falta um passo para ele chegar à sua carteira. ${AVISO_PAGAMENTO_SIMULADO}`,
    botao: 'Receber TESOURO',
  },
  concluir_swap: {
    titulo: 'Você tem TESOURO na carteira: conclua a compra',
    texto: `Seu pagamento foi confirmado e o TESOURO já está com você. Falta trocá-lo para concluir a compra. ${AVISO_PAGAMENTO_SIMULADO}`,
    botao: 'Concluir compra',
  },
  em_conferencia: {
    titulo: 'Sua compra está em conferência',
    texto: 'Já enviamos a troca e estamos conferindo na rede. Não refaça a compra.',
    botao: null,
  },
};

export function RetomarCompra({
  pendente,
  retomando,
  onRetomar,
}: {
  pendente: OrdemPendente;
  retomando: boolean;
  onRetomar: () => void;
}) {
  const t = TEXTO_RETOMADA[pendente.fase];
  return (
    <section
      role="region"
      aria-labelledby="retomar-compra-titulo"
      data-testid="retomar-compra"
      data-fase={pendente.fase}
      className="mb-10 border border-light-hairline bg-sheet-white px-5 py-5"
    >
      <h2 id="retomar-compra-titulo" className="font-title text-lg font-semibold tracking-tight">
        {t.titulo}
      </h2>
      <p className="font-text text-sm text-base/80 mt-2 max-w-prose leading-relaxed">{t.texto}</p>
      {t.botao && (
        <button
          type="button"
          onClick={onRetomar}
          disabled={retomando}
          className="mt-4 min-h-[44px] bg-base text-lightBg font-details text-[11px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors disabled:opacity-50"
        >
          {retomando ? 'Preparando…' : t.botao}
        </button>
      )}
    </section>
  );
}
