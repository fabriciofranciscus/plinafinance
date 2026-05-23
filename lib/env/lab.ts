/**
 * C-07: env-gate pras rotas `/api/lab/*`.
 *
 * Lab era exposto sem auth porque é "smoke endpoint". Problema: em
 * mainnet, atacante chama `/lab/build-trustline` com pubkey nova →
 * server tenta `fundAccountIfNeeded` (gratuito em testnet via
 * friendbot, dispara `createAccount` real em mainnet drenando o
 * funder; F-08).
 *
 * Solução: opt-in explícito por env. Só TESTNET + LAB_ENABLED=true.
 * Em mainnet sempre desligado (404), mesmo se o admin esquecer.
 */
import { STELLAR_NETWORK } from '../stellar/config';

export function isLabEnabled(): boolean {
  return (
    STELLAR_NETWORK === 'TESTNET' && process.env.LAB_ENABLED === 'true'
  );
}
