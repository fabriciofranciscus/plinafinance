/**
 * Grava o EventoAudit da TES-3 executada (queima do excesso de PLINARF da posição), com o MESMO registro canônico que
 * virou o memo da tx.
 *
 *   pnpm exec tsx scripts/registrar-tes-3-evento.ts --hash <hash da tx, 64 hex> --memo <memoHashHex> \
 *     --registro <arquivo> --carteiras-fora <n> --soma-fora <decimal> --valor-transferido-aprox <decimal BRL>
 *
 * O arquivo tem de conter o registroJson EXATO do plano (sem espaço ou quebra de linha a mais ou a menos; salve com
 * `printf '%s' '<registroJson>' > registro.json`). O script confere que o SHA-256 do arquivo é o memo; se não for, recusa
 * e não grava nada. Idempotente por hash. Usa o DATABASE_URL do .env.local. Não toca na chain.
 */

import { readFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { registrarTes3Queimada, Tes3RegistroError } from '../lib/services/tesouraria-excesso';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const hash = arg('--hash');
  const memo = arg('--memo');
  const arquivo = arg('--registro');
  const n = arg('--carteiras-fora');
  const soma = arg('--soma-fora');
  const valor = arg('--valor-transferido-aprox');
  if (!hash || !memo || !arquivo || n === undefined || !soma || !valor) {
    console.error(
      'Uso: registrar-tes-3-evento.ts --hash <64 hex> --memo <memoHashHex> --registro <arquivo> ' +
        '--carteiras-fora <n> --soma-fora <decimal> --valor-transferido-aprox <decimal>',
    );
    process.exit(2);
  }
  // Bytes exatos: sem trim, sem normalizar quebras de linha.
  const registroJson = readFileSync(arquivo, 'utf8');
  const r = await registrarTes3Queimada({
    hash,
    registroJson,
    memoHashHex: memo,
    operador: 'script-tes-3',
    nota: { carteirasForaDaPosicao: Number(n), somaForaDaPosicao: soma, valorTransferidoAproxBrl: valor },
  });
  console.log(
    r.registrado
      ? `EVENTO GRAVADO (TESOURARIA_EXCESSO_QUEIMADA). payloadHash ${r.payloadHash} = memo; tx ${hash}`
      : `JÁ REGISTRADO para a tx ${hash}; nada gravado (idempotente). payloadHash ${r.payloadHash}`,
  );
}

main()
  .catch((e) => {
    // Sem detalhes do banco no log (URL, usuário): só o código do erro.
    console.error('FALHOU:', e instanceof Tes3RegistroError ? `${e.code} — ${e.message}` : (e as { code?: string })?.code ?? 'erro inesperado');
    process.exit(1);
  })
  .finally(async () => {
    const { db } = await import('../lib/db');
    await db.$disconnect();
  });
