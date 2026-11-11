/**
 * Prova do avaliador (E3-1): refaz a conferência de um snapshot do NAV publicado, SÓ com o arquivo público e o Horizon.
 *
 *   pnpm snapshot:verificar <url-do-json> --distributor <G…> --network <testnet|public> [--issuer <G…>] [--tx <hash>]
 *
 * As contas e a rede NÃO são tomadas do arquivo sob verificação (um arquivo forjado traria as suas):
 *   · --distributor e --network: obrigatórios (o pacote de evidência da Plina informa);
 *   · issuer: o de --issuer, ou o do stellar.toml PÚBLICO da Plina ([[CURRENCIES]] code PLINARF;
 *     domínio padrão plina.finance, troque com --toml-domain).
 * A saída diz de onde veio cada conta. Confere: (1) o arquivo é o JSON canônico; (2) contas e rede = as informadas;
 * (3) Memo.hash da tx com source = distributor informado = SHA-256 do arquivo; (4) o NAV refeito do conteúdo;
 * (5) circulante, saldo do distributor e Σ trustlines autorizadas refeitos no Horizon. Saída 0 = tudo conferido ·
 * 1 = NÃO CONFERIDO (alguma conferência falhou) · 2 = nada falhou, mas há itens não conferidos (saldos mudaram
 * depois do snapshot: o Horizon não guarda saldo histórico).
 *
 * O leitor de Horizon abaixo é código PRÓPRIO do script, independente de `lib/stellar` (o verificador não pode
 * usar o mesmo caminho que produziu o número).
 */
import { Asset, Horizon, StellarToml } from '@stellar/stellar-sdk';
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
    async buscarPorMemo(conta, memoB64, desde) {
      const achadas: TxHorizon[] = [];
      let p = (await server.transactions().forAccount(conta).order('desc').limit(PAGINA).call()) as unknown as Pagina<TxHorizon>;
      for (let n = 1; p.records.length > 0; n++) {
        if (n > MAX_PAGINAS) throw new Error('histórico do distributor grande demais (limite de 50 páginas)');
        let passou = false;
        for (const t of p.records) {
          if (desde && t.created_at < desde) passou = true; // ordem desc: o resto é mais antigo que o arquivo
          else if (t.memo_type === 'hash' && t.memo === memoB64) achadas.push(t);
        }
        if (passou) break;
        p = await p.next();
      }
      return achadas;
    },
  };
}

const ICONE = { ok: '✓', falhou: '✗', nao_conferido: '?' } as const;
const uso =
  'uso: pnpm snapshot:verificar <https://url-do-json> --distributor <G…> --network <testnet|public> [--issuer <G…>] [--toml-domain <dominio>] [--tx <hash>]';

async function issuerDoToml(dominio: string, code: string): Promise<string> {
  const toml = await StellarToml.Resolver.resolve(dominio, { timeout: 10_000 });
  const achado = (toml.CURRENCIES ?? []).find((c: { code?: string; issuer?: string }) => c.code === code && c.issuer);
  if (!achado?.issuer) throw new Error(`stellar.toml de ${dominio} não lista ${code} em [[CURRENCIES]]; informe --issuer`);
  return achado.issuer;
}

async function main() {
  const args = process.argv.slice(2);
  const opcao = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const valores = new Set(['--tx', '--issuer', '--distributor', '--network', '--toml-domain'].map(opcao).filter(Boolean));
  const url = args.find((a) => !a.startsWith('--') && !valores.has(a));
  const distributorEsperado = opcao('--distributor');
  const rede = opcao('--network')?.toLowerCase();
  if (!url || !/^https?:\/\//.test(url) || !distributorEsperado || (rede !== 'testnet' && rede !== 'public')) {
    console.error(uso);
    process.exit(64);
  }
  const dominio = opcao('--toml-domain') ?? 'plina.finance';
  let issuerEsperado = opcao('--issuer');
  const fonteIssuer = issuerEsperado ? '--issuer (argumento)' : `stellar.toml de ${dominio}`;
  if (!issuerEsperado) {
    try {
      issuerEsperado = await issuerDoToml(dominio, 'PLINARF');
    } catch (e) {
      console.error(`ERRO: não foi possível obter o issuer da Plina (${e instanceof Error ? e.message : 'erro'}).\n${uso}`);
      process.exit(64);
    }
  }
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`download falhou: HTTP ${resp.status}`);
  const bytes = Buffer.from(await resp.arrayBuffer());

  const horizonUrl =
    process.env.STELLAR_HORIZON_URL ??
    (rede === 'public' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
  console.log(
    `Arquivo: ${url}\nRede: ${rede} (--network) · Horizon: ${horizonUrl}\n` +
      `Issuer: ${issuerEsperado} (de ${fonteIssuer})\nDistributor: ${distributorEsperado} (de --distributor)\n`,
  );

  const r = await verificarSnapshot(bytes, leitor(new Horizon.Server(horizonUrl)), {
    txHash: opcao('--tx'),
    issuerEsperado,
    distributorEsperado,
    redeEsperada: rede,
  });
  for (const c of r.conferencias) console.log(`${ICONE[c.estado]} ${c.id}: ${c.detalhe}`);
  console.log(
    r.codigoSaida === 0
      ? '\nCONFERIDO: o Memo.hash da âncora (tx do distributor informado) é o SHA-256 do arquivo; denominador e conciliação refeitos do Horizon; numerador = insumos publicados, cada cota com o seu hash de validação ancorado.'
      : r.codigoSaida === 2
        ? '\nINCOMPLETO: nada falhou, mas há itens NÃO conferidos (saldos que mudaram depois do snapshot). Veja os "?" acima.'
        : '\nNÃO CONFERIDO: alguma conferência falhou. Veja os "✗" acima.',
  );
  process.exit(r.codigoSaida);
}

main().catch((e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e);
  process.exit(1);
});
