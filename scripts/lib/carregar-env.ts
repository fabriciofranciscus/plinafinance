/**
 * Carrega o ambiente dos scripts com a precedência que o operador espera (A-13, Vera 14/11):
 *   variável da LINHA DE COMANDO / do shell  >  .env.local  >  .env
 *
 * Antes, `loadEnv('.env.local', { override: true })` fazia o arquivo VENCER o que o operador passou na linha de comando:
 * `DATABASE_URL=<outro banco> pnpm tsx scripts/x.ts` ainda atingia o banco do `.env.local` (incidente de 14/11, sem tx na rede).
 * O dotenv nunca sobrescreve uma variável que já existe, então a ordem aqui (o mais forte primeiro) basta: carregar
 * `.env.local` ANTES de `.env` e sem `override`.
 */
import { config } from 'dotenv';
import { join } from 'node:path';

export function carregarEnv(dir: string = '.'): void {
  config({ path: join(dir, '.env.local') });
  config({ path: join(dir, '.env') });
}
