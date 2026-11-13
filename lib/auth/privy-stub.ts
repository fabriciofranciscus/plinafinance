/**
 * Trava do stub do Privy (RT-1 da rodada do Argus, 12/11). `PRIVY_VERIFY_STUB=true` troca o login por
 * `Bearer e2e-stub-<pubkey>` (qualquer investidor) e desliga os rate limits: só pode valer em teste.
 *
 * O stub liga SOMENTE se `PRIVY_VERIFY_STUB=true` E (`NODE_ENV=test` OU `E2E_STUB=1`) E NÃO (`VERCEL_ENV=production` OU
 * `VERCEL_ENV=preview` OU `VERCEL=1` (qualquer runtime da Vercel) OU `STELLAR_NETWORK=PUBLIC`). O Preview é uma URL pública:
 * `E2E_STUB=1` + a flag lá abririam login de qualquer investidor e sem rate limit (Argus, RT-1 adendo). Qualquer outra combinação com a flag ligada é recusada (fail-closed): o login volta a
 * ser o verificador real do Privy, o rate limit volta a valer e o motivo vai para o log, uma vez, sem segredo.
 *
 * Contrato: contratos/2026-11-12-privy-stub-guard.md.
 */

export type MotivoStubRecusado =
  | 'VERCEL_ENV_PRODUCTION'
  | 'VERCEL_ENV_PREVIEW'
  | 'VERCEL_ENV_DEFINIDO'
  | 'VERCEL_RUNTIME'
  | 'STELLAR_NETWORK_PUBLIC'
  | 'FORA_DE_AMBIENTE_DE_TESTE';

type Env = Record<string, string | undefined>;

const jaLogados = new Set<MotivoStubRecusado>();

/** Só para testes. */
export function _resetPrivyStubLogForTests(): void {
  jaLogados.clear();
}

/** Por que o stub NÃO pode ligar neste ambiente, ou `null` se pode. Não lê nem devolve segredo. */
export function motivoStubRecusado(env: Env = process.env): MotivoStubRecusado | null {
  if (env.VERCEL_ENV === 'production') return 'VERCEL_ENV_PRODUCTION';
  if (env.VERCEL_ENV === 'preview') return 'VERCEL_ENV_PREVIEW';
  // QUALQUER VERCEL_ENV definido recusa (o banco de Preview é o de produção; F-RT1-1 da Vera): o E2E roda em localhost/CI,
  // onde a variável não existe, então a regra custa zero. Aparar espaços evita driblar com "  preview ".
  if ((env.VERCEL_ENV ?? '').trim() !== '') return 'VERCEL_ENV_DEFINIDO';
  if ((env.VERCEL ?? '').trim() !== '') return 'VERCEL_RUNTIME'; // qualquer execução na Vercel (VERCEL=1 ou outro valor)
  if ((env.STELLAR_NETWORK ?? '').trim().toUpperCase() === 'PUBLIC') return 'STELLAR_NETWORK_PUBLIC';
  if (env.NODE_ENV !== 'test' && env.E2E_STUB !== '1') return 'FORA_DE_AMBIENTE_DE_TESTE';
  return null;
}

/** O stub do Privy está ativo? (flag ligada E ambiente permitido). Flag desligada = falso e silencioso. */
export function privyStubAtivo(env: Env = process.env): boolean {
  if (env.PRIVY_VERIFY_STUB !== 'true') return false;
  const motivo = motivoStubRecusado(env);
  if (motivo === null) return true;
  if (!jaLogados.has(motivo)) {
    jaLogados.add(motivo);
    console.error(`[privy-stub] PRIVY_VERIFY_STUB=true RECUSADO (${motivo}): usando a verificação real do Privy e os rate limits normais`);
  }
  return false;
}
