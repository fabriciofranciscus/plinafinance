/**
 * Seletor do provedor de Pix de saída. `PSP_PROVIDER` = `ASAAS` | `SIMULADO` (padrão `SIMULADO`).
 * Valor desconhecido → `PSP_CONFIG` (nunca cai em outro provedor em silêncio). O getter/flag oficial é do Farol
 * (`lib/env`): quando existir, só este arquivo muda.
 */
import { criarAsaasProvider } from './asaas';
import { criarSimuladoProvider } from './simulado';
import { PspError, type PixProvider } from './types';

export function obterPixProvider(): PixProvider {
  const nome = (process.env.PSP_PROVIDER ?? 'SIMULADO').trim().toUpperCase();
  if (nome === 'SIMULADO') return criarSimuladoProvider();
  if (nome === 'ASAAS') return criarAsaasProvider();
  throw new PspError('PSP_CONFIG');
}

export * from './types';
