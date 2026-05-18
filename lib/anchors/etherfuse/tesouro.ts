/**
 * Resolve TESOURO asset (code + issuer) via Etherfuse /ramp/assets.
 *
 * Etherfuse devolve identifier no formato `CODE:ISSUER`. Cacheamos por
 * processo — TESOURO issuer não muda em runtime, e a chamada GET assets
 * adiciona ~200ms se feita em todo request.
 */

import { EtherfuseClient } from './index';

interface TesouroAsset {
  code: string;
  issuer: string;
  identifier: string;
}

let cached: TesouroAsset | null = null;

export async function resolveTesouroAsset(
  publicKeyHint: string,
): Promise<TesouroAsset> {
  if (cached) return cached;

  const apiKey = process.env.ETHERFUSE_API_KEY;
  if (!apiKey) throw new Error('ETHERFUSE_API_KEY ausente.');

  const anchor = new EtherfuseClient({
    apiKey,
    baseUrl:
      process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com',
  });

  const resp = await anchor.getAssets('stellar', 'brl', publicKeyHint);
  const tesouro = resp.assets.find((a) => a.symbol === 'TESOURO');
  if (!tesouro) {
    throw new Error('TESOURO indisponível em /ramp/assets — anchor sem suporte BR.');
  }

  const [code, issuer] = tesouro.identifier.split(':');
  if (!code || !issuer) {
    throw new Error(`TESOURO identifier inválido: ${tesouro.identifier}`);
  }

  cached = { code, issuer, identifier: tesouro.identifier };
  return cached;
}
