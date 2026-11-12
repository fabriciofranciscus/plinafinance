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
 * (5) o distributor consta em ACCOUNTS do stellar.toml da Plina (domínio ≠ plina.finance = aviso); (6) cada cota ativa: emissaoTxHash existe no Horizon, do issuer, com Memo.hash; (7) circulante, saldo do distributor e Σ trustlines autorizadas refeitos no Horizon. Saída 0 = tudo conferido ·
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
    async transacao(hash) {
      try {
        return (await server.transactions().transaction(hash).call()) as unknown as TxHorizon;
      } catch (e) {
        if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
        throw e;
      }
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

const ICONE = { ok: '✓', falhou: '✗', nao_conferido: '?', aviso: '!' } as const;
const uso =
  'uso: pnpm snapshot:verificar <https://url-do-json> --distributor <G…> --network <testnet|public> [--issuer <G…>] [--toml-domain <dominio>] [--tx <hash>] [--tesouro <CODE:ISSUER> --preco-tesouro <BRL>]';

type Toml = { CURRENCIES?: Array<{ code?: string; issuer?: string }>; ACCOUNTS?: string[] };

async function lerToml(dominio: string): Promise<Toml | null> {
  try {
    return (await StellarToml.Resolver.resolve(dominio, { timeout: 10_000 })) as Toml;
  } catch {
    return null; // sem toml: o issuer vem de --issuer e o distributor fica "não conferido" no toml
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opcao = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const valores = new Set(['--tx', '--issuer', '--distributor', '--network', '--toml-domain', '--tesouro', '--preco-tesouro'].map(opcao).filter(Boolean));
  const url = args.find((a) => !a.startsWith('--') && !valores.has(a));
  const distributorEsperado = opcao('--distributor');
  const rede = opcao('--network')?.toLowerCase();
  if (!url || !/^https?:\/\//.test(url) || !distributorEsperado || (rede !== 'testnet' && rede !== 'public')) {
    console.error(uso);
    process.exit(64);
  }
  const dominio = opcao('--toml-domain') ?? 'plina.finance';
  // Conferência parcial opcional (TESOURO do distributor × preço de referência ≥ caixa): as duas opções juntas.
  const tesouroArg = opcao('--tesouro');
  const precoArg = opcao('--preco-tesouro');
  let tesouro: { code: string; issuer: string; precoBrl: string } | undefined;
  if (tesouroArg || precoArg) {
    const [code, issuer] = (tesouroArg ?? '').split(':');
    if (!code || !issuer || !precoArg || !/^\d+(\.\d+)?$/.test(precoArg)) {
      console.error(`ERRO: --tesouro <CODE:ISSUER> e --preco-tesouro <BRL> andam juntos (preço decimal).\n${uso}`);
      process.exit(64);
    }
    tesouro = { code, issuer, precoBrl: precoArg };
  }
  const toml = await lerToml(dominio);
  let issuerEsperado = opcao('--issuer');
  const fonteIssuer = issuerEsperado ? '--issuer (argumento)' : `stellar.toml de ${dominio}`;
  if (!issuerEsperado) {
    issuerEsperado = (toml?.CURRENCIES ?? []).find((c) => c.code === 'PLINARF' && c.issuer)?.issuer;
    if (!issuerEsperado) {
      console.error(`ERRO: não foi possível obter o issuer da Plina (stellar.toml de ${dominio} ilegível ou sem PLINARF em [[CURRENCIES]]); informe --issuer.\n${uso}`);
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
    tesouro,
    toml: { dominio, accounts: Array.isArray(toml?.ACCOUNTS) ? toml.ACCOUNTS : null },
  });
  for (const c of r.conferencias) console.log(`${ICONE[c.estado]} ${c.id}: ${c.detalhe}`);
  console.log(
    r.codigoSaida === 0
      ? '\nCONFERIDO: o Memo.hash da âncora (tx do distributor informado) é o SHA-256 do arquivo; denominador e conciliação refeitos do Horizon; numerador = insumos publicados, cada cota com o seu hash de validação ancorado.'
      : r.codigoSaida === 2
        ? '\nINCOMPLETO: nada falhou, mas há itens NÃO conferidos (ex.: distributor fora do ACCOUNTS do toml, domínio do toml, ou saldos que mudaram depois do snapshot). Veja os "?" acima.'
        : '\nNÃO CONFERIDO: alguma conferência falhou. Veja os "✗" acima.',
  );
  process.exit(r.codigoSaida);
}

main().catch((e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e);
  process.exit(1);
});
