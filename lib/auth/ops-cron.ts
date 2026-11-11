/**
 * Guard das rotas de operação disparadas por agendador (GET /api/ops/*), contrato do Atlas
 * (alarme-emissao-pendente): `Authorization: Bearer <OPS_CRON_SECRET>`, comparado em tempo constante.
 * Rota NÃO divulgada: sem o secret configurado, sem o header ou com secret errado → 404 (nunca 401/403,
 * para não revelar que a rota existe). Rate limit por IP ANTES da checagem do secret (barra força bruta).
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { clientIp, publicLimiter } from '../rate-limit/config';

const naoEncontrado = () => NextResponse.json({ error: 'not found' }, { status: 404 });

/** Compara em tempo constante (hash de tamanho fixo dos dois lados). */
function iguais(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** `null` = autorizado; senão a resposta pronta (429 do rate limit ou 404). */
export async function requireOpsCron(req: Request): Promise<Response | null> {
  if (!(await publicLimiter.consume(clientIp(req)))) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }
  const secret = process.env.OPS_CRON_SECRET?.trim();
  if (!secret) return naoEncontrado(); // sem secret configurado a rota não existe (fail-closed)
  const auth = req.headers.get('authorization') ?? '';
  const prefixo = 'Bearer ';
  if (!auth.startsWith(prefixo)) return naoEncontrado();
  return iguais(auth.slice(prefixo.length).trim(), secret) ? null : naoEncontrado();
}
