/**
 * Postgres DESCARTÁVEL do smoke do ciclo (E3-2). Nunca o Neon: o banco nasce aqui, recebe as migrations e morre no fim.
 *  - padrão: contêiner `postgres:17-alpine` em 127.0.0.1 numa porta livre, removido ao terminar;
 *  - ou `SMOKE_CICLO_PG_URL=postgresql://user:senha@127.0.0.1:PORTA/db` (Postgres local já vazio; só host local é aceito).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

export interface BancoDescartavel {
  url: string;
  origem: 'docker' | 'url-local';
  encerrar(): void;
}

const HOSTS_LOCAIS = ['127.0.0.1', 'localhost', '::1', '[::1]'];

export function exigirHostLocal(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('SMOKE_CICLO_PG_URL inválida.');
  }
  if (!HOSTS_LOCAIS.includes(host)) throw new Error('O smoke só roda contra um Postgres LOCAL descartável (nunca o Neon).');
}

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function aplicarMigrations(url: string): void {
  const r = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`prisma migrate deploy falhou:\n${(r.stderr || r.stdout).slice(-800)}`);
}

export async function subirBanco(): Promise<BancoDescartavel> {
  const informada = (process.env.SMOKE_CICLO_PG_URL ?? '').trim();
  if (informada) {
    exigirHostLocal(informada);
    aplicarMigrations(informada);
    return { url: informada, origem: 'url-local', encerrar() {} };
  }
  try {
    docker(['version', '--format', '{{.Server.Version}}']);
  } catch {
    throw new Error('Docker indisponível. Suba um Postgres local vazio e passe SMOKE_CICLO_PG_URL=postgresql://...@127.0.0.1:PORTA/db');
  }
  const nome = `plina-smoke-ciclo-${randomBytes(4).toString('hex')}`;
  const senha = randomBytes(12).toString('hex');
  docker(['run', '-d', '--rm', '--name', nome, '-e', `POSTGRES_PASSWORD=${senha}`, '-e', 'POSTGRES_DB=plina_smoke', '-p', '127.0.0.1::5432', 'postgres:17-alpine']);
  const encerrar = () => {
    try {
      docker(['rm', '-f', nome]);
    } catch {
      /* já removido */
    }
  };
  try {
    const porta = docker(['port', nome, '5432/tcp']).split('\n')[0]!.split(':').pop()!;
    // O Postgres reinicia uma vez durante a inicialização do contêiner: espera 3 respostas seguidas.
    let seguidas = 0;
    for (let i = 0; i < 60 && seguidas < 3; i++) {
      try {
        docker(['exec', nome, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'plina_smoke']);
        seguidas++;
      } catch {
        seguidas = 0;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (seguidas < 3) throw new Error('o Postgres descartável não ficou pronto em 60 s');
    const url = `postgresql://postgres:${senha}@127.0.0.1:${porta}/plina_smoke`;
    aplicarMigrations(url);
    return { url, origem: 'docker', encerrar };
  } catch (e) {
    encerrar();
    throw e;
  }
}
