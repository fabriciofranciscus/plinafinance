/**
 * Provedor SIMULADO (fallback, `PSP_PROVIDER` ausente ou `SIMULADO`): nenhum dinheiro, nenhuma rede. Conclui na hora
 * com id determinístico da idempotencyKey. Nunca "acha" transferência por chave (não há estado para achar), então a
 * recuperação de um envio ambíguo não finge que algo saiu. O comprovante gerado a partir dele é rotulado `SIMULADO`.
 */
import { createHash } from 'node:crypto';
import { PspError, validarEnvio, type ConsultaPix, type EnvioPix, type PixProvider } from './types';

const idDe = (chave: string) => `sim_${createHash('sha256').update(chave).digest('hex').slice(0, 24)}`;

export function criarSimuladoProvider(agora: () => Date = () => new Date()): PixProvider {
  return {
    nome: 'SIMULADO',
    async enviarPix(entrada: EnvioPix) {
      const i = validarEnvio(entrada);
      return { id: idDe(i.idempotencyKey), status: 'CONCLUIDO' };
    },
    async consultarStatus(id: string): Promise<ConsultaPix> {
      if (!/^sim_[0-9a-f]{24}$/.test(id)) throw new PspError('PSP_RECUSOU');
      return { id, status: 'CONCLUIDO', e2eId: null, efetivadoEm: agora().toISOString(), motivoFalha: null };
    },
    async localizarPorChave() {
      return null;
    },
  };
}
