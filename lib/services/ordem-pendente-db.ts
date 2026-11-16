/**
 * A compra que o investidor ainda não terminou, lida do banco: a ÚNICA leitura, usada pela rota GET
 * /api/investidor/buy/pendente (retomada no /investir, U2 A-02) e pelo resumo da conta (/inicio, A-07). Assim as duas telas
 * nunca discordam sobre haver ou não compra pendente. Só leitura.
 *
 * Não filtra a validade da cotação: ela dura ~2 min e o swap/build a renova (cria uma nova e religa a ordem); filtrar por ela
 * fazia a compra liquidada SUMIR da lista depois de recarregar (A-07).
 */
import { db } from '../db';
import { faseDaOrdem, STATUS_ORDEM_ENCERRADA, type FaseOrdemPendente } from './ordem-pendente';

export async function buscarOrdemPendente(investidorId: string) {
  const ordem = await db.onRampOrder.findFirst({
    where: {
      investidorId,
      status: { notIn: [...STATUS_ORDEM_ENCERRADA] },
      quote: { consumedAt: null },
    },
    orderBy: { criadoEm: 'desc' },
    include: { quote: true },
  });
  const fase: FaseOrdemPendente | null = ordem ? faseDaOrdem(ordem) : null;
  return ordem && fase ? { ordem, fase } : null;
}
