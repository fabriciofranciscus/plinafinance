/**
 * Prova do avaliador (E3-1): refaz a conferência de um snapshot do NAV publicado, SÓ com o arquivo público e o Horizon.
 *
 *   pnpm snapshot:verificar <url-do-json> [--tx <hash-da-ancora>]
 *
 * Não usa banco nem segredo; a rede vem do próprio arquivo (`rede`) e o Horizon é o público dela
 * (`STELLAR_HORIZON_URL` troca). Confere: (1) o arquivo é o JSON canônico; (2) o Memo.hash da tx do distributor = SHA-256
 * do arquivo; (3) o NAV refeito do conteúdo; (4) circulante, saldo do distributor e Σ trustlines autorizadas
 * refeitos no Horizon. Saída 0 = tudo conferido · 1 = alguma falhou · 2 = nada falhou, mas os saldos mudaram depois do
 * snapshot e o Horizon não guarda saldo histórico.
 *
 * O leitor de Horizon abaixo é código PRÓPRIO do script, independente de `lib/stellar` (o verificador não pode
 * usar o mesmo caminho que produziu o número).
 */
import { Asset, Horizon } from '@stellar/stellar-sdk';
import { Prisma } from '@prisma/client';
import {
  verificarSnapshot,
  type LeitorHorizon,
  type TxHorizon,
} from '../lib/services/snapshot-nav-verificar';

const PAGINA = 200;
const MAX_PAGINAS = 50;
const D = (v: string | number) => new Prisma.Decimal(v);

type Pagina<T> = { records: T[]; next(): Promise<Pagina<T>> };
type Linha = { asset_code?: string; asset_issuer?: string; balance: string; is_authorized?: boolean };

function leitor(server: Horizon.Server): LeitorHorizon {
  return {
    async ledgerAtual() {
      const r = await server.root();
      return { ledger: r.history_latest_ledger, fechadoEm: r.history_latest_ledger_closed_at };
    },
    async totalEmitido(code, issuer) {
      const page = await server.assets().forCode(code).forIssuer(issuer).call();
      const rec = page.records[0];
      if (!rec) return D(0);
      return D(rec.balances.authorized)
        .plus(rec.balances.authorized_to_maintain_liabilities)
        .plus(rec.balances.unauthorized)
        .plus(rec.claimable_balances_amount)
        .plus(rec.liquidity_pools_amount)
        .plus(rec.contracts_amount);
    },
    async saldoDaConta(conta, code, issuer) {
      const c = await server.loadAccount(conta);
      const l = (c.balances as Linha[]).find((b) => b.asset_code === code && b.asset_issuer === issuer);
      return l ? D(l.balance) : D(0);
    },
    async trustlinesAutorizadas(code, issuer, excluir) {
      let soma = D(0);
      let contas = 0;
      let p = (await server.accounts().forAsset(new Asset(code, issuer)).limit(PAGINA).call()) as unknown as Pagina<{
        account_id?: string;
        id?: string;
        balances: Linha[];
      }>;
      for (let n = 1; p.records.length > 0; n++) {
        if (n > MAX_PAGINAS) throw new Error('muitas contas no asset para conferir (limite de 50 páginas)');
        for (const c of p.records) {
          if ((c.account_id ?? c.id) === excluir) continue;
          const l = c.balances.find((b) => b.asset_code === code && b.asset_issuer === issuer);
          if (l?.is_authorized === true) {
            soma = soma.plus(l.balance);
            contas += 1;
          }
        }
        p = await p.next();
      }
      return { soma, contas };
    },
    async buscarPorMemo(conta, memoB64) {
      const achadas: TxHorizon[] = [];
      let p = (await server.transactions().forAccount(conta).order('desc').limit(PAGINA).call()) as unknown as Pagina<TxHorizon>;
      for (let n = 1; p.records.length > 0; n++) {
        if (n > MAX_PAGINAS) throw new Error('histórico do distributor grande demais (limite de 50 páginas)');
        for (const t of p.records) if (t.memo_type === 'hash' && t.memo === memoB64) achadas.push(t);
        p = await p.next();
      }
      return achadas;
    },
  };
}

const ICONE = { ok: '✓', falhou: '✗', nao_conferido: '?' } as const;

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--tx');
  const tx = args.includes('--tx') ? args[args.indexOf('--tx') + 1] : undefined;
  if (!url || !/^https?:\/\//.test(url)) {
    console.error('uso: pnpm snapshot:verificar <https://url-do-json> [--tx <hash>]');
    process.exit(64);
  }
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`download falhou: HTTP ${resp.status}`);
  const bytes = Buffer.from(await resp.arrayBuffer());

  let rede = 'TESTNET';
  try {
    rede = (JSON.parse(bytes.toString('utf8')) as { rede?: string }).rede ?? rede;
  } catch {
    /* o núcleo reporta arquivo inválido */
  }
  const horizonUrl =
    process.env.STELLAR_HORIZON_URL ??
    (rede === 'PUBLIC' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
  console.log(`Arquivo: ${url}\nRede: ${rede} · Horizon: ${horizonUrl}\n`);

  const r = await verificarSnapshot(bytes, leitor(new Horizon.Server(horizonUrl)), { txHash: tx });
  for (const c of r.conferencias) console.log(`${ICONE[c.estado]} ${c.id}: ${c.detalhe}`);
  console.log(
    r.codigoSaida === 0
      ? '\nCONFERIDO: o Memo.hash da âncora é o SHA-256 do arquivo e o NAV foi refeito só com o arquivo e o Horizon.'
      : r.codigoSaida === 2
        ? '\nNADA FALHOU, mas há itens que o Horizon já não permite refazer (saldos mudaram depois do snapshot). Veja os "?" acima.'
        : '\nFALHOU: veja os "✗" acima.',
  );
  process.exit(r.codigoSaida);
}

main().catch((e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e);
  process.exit(1);
});
