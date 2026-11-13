/**
 * Seletor do provedor de Pix de saída. `PSP_PROVIDER` = `ASAAS` | `SIMULADO` (padrão `SIMULADO`).
 * Valor desconhecido → `PSP_CONFIG` (nunca cai em outro provedor em silêncio). Em `STELLAR_NETWORK=PUBLIC` qualquer
 * provedor atual (simulado ou Asaas sandbox) é recusado com `PSP_CONFIG`, inclusive o padrão (P1 do Argus). O getter/flag oficial é do Farol
 * (`lib/env`): quando existir, só este arquivo muda.
 */
import { criarAsaasProvider } from './asaas';
import { criarSimuladoProvider } from './simulado';
import { PspError, exigirRedeDeTeste, type PixProvider } from './types';

/**
 * Nome do provedor configurado (`PSP_PROVIDER`; padrão `SIMULADO`), SEM criar o provedor nem ler credencial: serve a quem
 * precisa saber qual é o provedor para decidir uma regra (ex.: o atestado do titular aceitar CPF sintético só com o
 * SIMULADO). Valor desconhecido → `PSP_CONFIG` (nunca cai em outro em silêncio).
 */
export function nomeDoProvedorConfigurado(): 'ASAAS' | 'SIMULADO' {
  const nome = (process.env.PSP_PROVIDER ?? 'SIMULADO').trim().toUpperCase();
  if (nome === 'SIMULADO' || nome === 'ASAAS') return nome;
  throw new PspError('PSP_CONFIG');
}

export function obterPixProvider(): PixProvider {
  exigirRedeDeTeste();
  return nomeDoProvedorConfigurado() === 'ASAAS' ? criarAsaasProvider() : criarSimuladoProvider();
}

export * from './types';
