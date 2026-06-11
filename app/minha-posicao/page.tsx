/**
 * /minha-posicao — absorvida pelo /painel.
 *
 * O extrato institucional do investidor (posição, NAV, holdings por classe,
 * compliance, atividade auditável e liquidação) virou a Dashboard do /painel.
 * Esta rota agora só redireciona, preservando links/bookmarks antigos.
 */

import { redirect } from 'next/navigation';

export default function MinhaPosicaoPage() {
  redirect('/painel');
}
