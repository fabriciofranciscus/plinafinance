/**
 * Seletor do provedor de Pix de saída. `PSP_PROVIDER` = `ASAAS` | `SIMULADO` (padrão `SIMULADO`).
 * Valor desconhecido → `PSP_CONFIG` (nunca cai em outro provedor em silêncio). Em `STELLAR_NETWORK=PUBLIC` qualquer
 * provedor atual (simulado ou Asaas sandbox) é recusado com `PSP_CONFIG`, inclusive o padrão (P1 do Argus). O getter/flag oficial é do Farol
 * (`lib/env`): quando existir, só este arquivo muda.
 */
import { criarAsaasProvider } from './asaas';
import { criarSimuladoProvider } from './simulado';
import { PspError, exigirRedeDeTeste, type PixProvider } from './types';

export function obterPixProvider(): PixProvider {
  exigirRedeDeTeste();
  const nome = (process.env.PSP_PROVIDER ?? 'SIMULADO').trim().toUpperCase();
  if (nome === 'SIMULADO') return criarSimuladoProvider();
  if (nome === 'ASAAS') return criarAsaasProvider();
  throw new PspError('PSP_CONFIG');
}

export * from './types';
