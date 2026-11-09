/**
 * Smoke test — cadeia COMPLETA do investidor, com prova on-chain de cada perna.
 *
 * Responde à pergunta "temos algo que comprove que o investidor manda Pix, a
 * Etherfuse recebe e entrega o ativo-ponte na Stellar, e o swap pra PLINA-RF
 * acontece?" — executando exatamente isso e imprimindo as provas verificáveis.
 *
 *   1. GET  /ramp/me                       — auth no anchor.
 *   2. GET  /ramp/assets                   — descobre o ativo-ponte (sandbox ≠ prod).
 *   3. friendbot                           — cria a carteira do investidor.
 *   4. POST /ramp/wallet                   — registra a carteira no anchor.
 *   5. POST /ramp/customer/{id}/bank-account — registra chave Pix (BRL).
 *   6. POST /ramp/quote                    — cotação BRL → ativo-ponte.
 *   7. POST /ramp/order                    — cria a ordem de onramp.
 *   8. POST /ramp/order/fiat_received      — simula o Pix caindo (sandbox).
 *   9. GET  /ramp/order/{id}               — poll até `completed`.
 *  10. PROVA 1: claimable balance existe no ledger (Horizon).
 *  11. PROVA 2: investidor assina e submete o claim → tx hash on-chain.
 *  12. PROVA 3: ativo-ponte creditado na carteira (Horizon).
 *  13. trustline PLINARF + autorização do issuer (AUTH_REQUIRED).
 *  14. PROVA 4: swap atômico ativo-ponte → PLINARF, 2 pernas, 1 tx.
 *  15. PROVA 5: PLINARF creditado na carteira (Horizon).
 *
 * As pernas on-chain usam o código de PRODUÇÃO (`lib/stellar/*`) — o smoke
 * prova o que a aplicação faz, não uma reimplementação. As chamadas ao anchor
 * são feitas direto por HTTP de propósito: assim este arquivo também serve de
 * referência do contrato REAL da API hoje, que é o alvo da migração do cliente
 * vendorizado (que ainda chama endpoints removidos).
 *
 * Rodar:  pnpm smoke:investidor
 * Saída:  smoke-investidor-output.json (NÃO commitar — contém secret de teste).
 *
 * Variáveis opcionais:
 *   SMOKE_BRL=400              valor da ordem (o sandbox limita onramps a 500)
 *   SMOKE_POLL_SECONDS=300     quanto esperar o anchor liquidar
 *   SMOKE_RESUME_ORDER=<uuid>  retoma uma ordem já criada, pulando os passos 4–8
 *   SMOKE_INVESTOR_SECRET=S... carteira da ordem retomada (sai no output JSON)
 *   SMOKE_SWAP_BRIDGE / SMOKE_SWAP_PLINARF   valores do swap (default: tudo / BRL)
 *
 * Quando o anchor engasga (ordem fica em `funded` sem entregar), retome com:
 *   SMOKE_RESUME_ORDER=<uuid> SMOKE_INVESTOR_SECRET=<secret> pnpm smoke:investidor
 */

import { config as loadEnv } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Transaction, Keypair, TransactionBuilder, Operation, Asset } from '@stellar/stellar-sdk';
import { getAssetBalance, horizon, buildAsset } from '../lib/stellar/account';
import { networkPassphrase, assetCode } from '../lib/stellar/config';
import { buildSwapBridgeForPlinarfXdr } from '../lib/stellar/transactions';
import { createTrustline, authorizeTrustline } from '../lib/stellar/issuer';
import { issuerSigner, distributorSigner, KeypairSigner } from '../lib/stellar/signer';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });

const TOTAL = 15;
const step = (n: number, label: string) => console.log(`\n━━━ [${n}/${TOTAL}] ${label}`);
const ok = (m: string) => console.log(`     ✓ ${m}`);
const info = (m: string) => console.log(`     · ${m}`);
const proof = (m: string) => console.log(`     🔗 ${m}`);
const warn = (m: string) => console.log(`     ! ${m}`);

const BASE = process.env.ETHERFUSE_BASE_URL || 'https://api.sand.etherfuse.com';
const KEY = process.env.ETHERFUSE_API_KEY;
const EXPLORER = 'https://stellar.expert/explorer/testnet';

/** Valor em BRL. O sandbox do anchor limita onramps a 500. */
const BRL = process.env.SMOKE_BRL ?? '400';

const out: Record<string, unknown> = { startedAt: new Date().toISOString(), network: process.env.STELLAR_NETWORK };

/** Erro de contrato (4xx): culpa do request, repetir não adianta. */
class ApiError extends Error {}

/**
 * Cliente HTTP do anchor com timeout, retry e diagnóstico.
 *
 * `fetch` do Node esconde a causa real num `TypeError: fetch failed` genérico —
 * sem desempacotar `cause`, um ECONNRESET vira "deu ruim" e some a informação
 * que diz se o problema é a rede de quem rodou, o fornecedor, ou nós.
 * 4xx não é retentado (é contrato); 5xx e falha de rede são.
 */
async function api<T>(path: string, init?: RequestInit, attempts = 3): Promise<T> {
  let last = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { Authorization: KEY!, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      if (res.ok) return (text ? JSON.parse(text) : {}) as T;
      const msg = `${init?.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`;
      if (res.status < 500) throw new ApiError(msg);
      last = msg; // 5xx: transitório, vale repetir
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      const detail = cause?.code ?? cause?.message ?? (e as Error).message;
      last = `${init?.method ?? 'GET'} ${path} → falha de rede: ${detail}`;
    }
    if (attempt < attempts) {
      warn(`${last} — tentativa ${attempt}/${attempts}, repetindo`);
      await sleep(1500 * attempt);
    }
  }
  throw new Error(`${last} (após ${attempts} tentativas)`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!KEY) throw new Error('ETHERFUSE_API_KEY ausente — configure .env.local');
  if (process.env.STELLAR_NETWORK === 'PUBLIC') {
    throw new Error('Este smoke é testnet-only. STELLAR_NETWORK=PUBLIC recusado.');
  }

  // ── 1. auth ────────────────────────────────────────────────────────────────
  step(1, 'Auth no anchor — GET /ramp/me');
  const me = await api<{ id: string; displayName: string }>('/ramp/me');
  ok(`org "${me.displayName}" (${me.id})`);
  out.org = me;

  // ── 2. ativo-ponte ─────────────────────────────────────────────────────────
  step(2, 'Descobrir o ativo-ponte — GET /ramp/assets');
  // Carteira NÃO financiada de propósito: é o cenário real do investidor, que
  // chega sem conta on-chain e sem trustline. O anchor patrocina as duas coisas
  // quando `walletAddress` vai na quote. Financiar antes (ex: friendbot) faz o
  // anchor não precificar o patrocínio, a trustline não ser criada, e a ordem
  // travar em `funded` para sempre — falha silenciosa documentada pelo fornecedor.
  // Retomada: quando o anchor engasga (ordem fica em `funded`), a carteira e a
  // ordem continuam válidas. Reexecutar do zero desperdiça — e deixa claimable
  // balance órfão para trás. Com as duas variáveis abaixo o smoke pula direto
  // para o poll e segue da perna on-chain.
  const resumeOrder = process.env.SMOKE_RESUME_ORDER;
  const investor = process.env.SMOKE_INVESTOR_SECRET
    ? Keypair.fromSecret(process.env.SMOKE_INVESTOR_SECRET)
    : Keypair.random();
  const assetsRes = await api<{ assets: Array<{ symbol: string; identifier: string; currency: string | null }> }>(
    `/ramp/assets?blockchain=stellar&currency=brl&wallet=${investor.publicKey()}`,
  );
  const bridge = assetsRes.assets.find((a) => a.currency === 'brl');
  if (!bridge) throw new Error('nenhum ativo denominado em BRL no catálogo do anchor');
  const [bridgeCode, bridgeIssuer] = bridge.identifier.split(':');
  ok(`${bridge.symbol} — ${bridge.identifier}`);
  info('identificadores diferem entre sandbox e produção: sempre ler de /ramp/assets');
  out.bridgeAsset = bridge;

  // ── 3. carteira ────────────────────────────────────────────────────────────
  step(3, 'Carteira do investidor — gerada, sem fundos');
  ok(`${investor.publicKey()}`);
  info('ainda não existe on-chain; quem cria e patrocina a trustline é o anchor');
  proof(`${EXPLORER}/account/${investor.publicKey()}`);
  // Persistido JÁ, não no fim: se o smoke morrer no meio, a carteira pode ter
  // um claimable balance pendente. Sem a secret aqui, ele fica inalcançável e
  // não há como retomar de onde parou.
  out.investor = { publicKey: investor.publicKey() };
  out.investorSecret = investor.secret();

  let orderId: string;
  if (resumeOrder) {
    step(4, 'Retomando ordem existente — passos 4 a 8 pulados');
    orderId = resumeOrder;
    ok(`orderId ${orderId}`);
    info(`carteira ${investor.publicKey()}`);
  } else {

  // ── 4. registrar carteira ──────────────────────────────────────────────────
  step(4, 'Registrar carteira no anchor — POST /ramp/wallet');
  const wallet = await api<{ walletId: string }>('/ramp/wallet', {
    method: 'POST',
    body: JSON.stringify({ blockchain: 'stellar', publicKey: investor.publicKey() }),
  });
  ok(`walletId ${wallet.walletId}`);

  // ── 5. conta Pix ───────────────────────────────────────────────────────────
  step(5, 'Chave Pix (BRL) — GET/POST /ramp/customer/{id}/bank-account');
  type Bank = { bankAccountId: string; currency: string; status: string; compliant?: boolean };
  const existing = await api<{ items: Bank[] }>(`/ramp/customer/${me.id}/bank-accounts`);
  let bank = existing.items.find((b) => b.currency === 'brl');
  if (bank) {
    ok(`reusando ${bank.bankAccountId} · ${bank.currency} · ${bank.status}`);
    info('a API aceita apenas UMA conta BRL por organização — o smoke reusa para ser re-executável');
  } else {
    const cpf = process.env.SMOKE_CPF ?? '11144477735'; // CPF de teste, checksum válido
    bank = await api<Bank>(`/ramp/customer/${me.id}/bank-account`, {
      method: 'POST',
      body: JSON.stringify({
        account: {
          firstName: 'Smoke', lastName: 'Plina', cpf,
          pixKey: cpf, pixKeyType: 'cpf', countryIsoCode: 'BR',
          transactionId: randomUUID(),
        },
        label: `smoke ${new Date().toISOString().slice(0, 10)}`,
      }),
    });
    ok(`criada ${bank.bankAccountId} · ${bank.currency} · ${bank.status} · compliant=${bank.compliant}`);
    info('o smoke-etherfuse antigo registra esta rota como fechada upstream — hoje ela responde 201');
  }
  out.bankAccount = bank;

  // ── 6. quote ───────────────────────────────────────────────────────────────
  step(6, `Cotação BRL → ${bridge.symbol} — POST /ramp/quote`);
  const quoteId = randomUUID();
  const quote = await api<{ sourceAmount: string; destinationAmount: string; exchangeRate: string; feeBps: string }>(
    '/ramp/quote',
    {
      method: 'POST',
      body: JSON.stringify({
        quoteId, blockchain: 'stellar', customerId: me.id, sourceAmount: BRL,
        quoteAssets: { type: 'onramp', sourceAsset: 'BRL', targetAsset: bridge.identifier },
        walletAddress: investor.publicKey(),
      }),
    },
  );
  ok(`R$ ${quote.sourceAmount} → ${quote.destinationAmount} ${bridge.symbol} (fee ${quote.feeBps} bps)`);
  info('fee maior que 20 bps aqui embute o patrocínio de conta + trustline (primeira entrada da carteira)');
  out.quote = { quoteId, ...quote };

  // ── 7. ordem ───────────────────────────────────────────────────────────────
  step(7, 'Criar ordem de onramp — POST /ramp/order');
  orderId = randomUUID();
  const order = await api<{ onramp: { orderId: string; depositClabe: string; depositBankName: string } }>('/ramp/order', {
    method: 'POST',
    body: JSON.stringify({
      orderId, quoteId, bankAccountId: bank.bankAccountId,
      publicKey: investor.publicKey(), blockchain: 'stellar', direction: 'onramp',
    }),
  });
  ok(`orderId ${order.onramp.orderId}`);
  if (!order.onramp.depositClabe) {
    warn(`instrução de depósito VAZIA (bank="${order.onramp.depositBankName}") — em produção o investidor`);
    warn('não teria para onde mandar o Pix. É a última milha pendente do lado do anchor.');
  }
  out.order = order.onramp;

  // ── 8. Pix simulado ────────────────────────────────────────────────────────
  step(8, 'Simular o Pix caindo — POST /ramp/order/fiat_received (sandbox)');
  await api('/ramp/order/fiat_received', { method: 'POST', body: JSON.stringify({ orderId }) });
  ok('recebimento simulado aceito');

  } // fim do bloco pulado na retomada

  // ── 9. poll ────────────────────────────────────────────────────────────────
  step(9, 'Aguardar liquidação — GET /ramp/order/{id}');
  const pollSec = Number(process.env.SMOKE_POLL_SECONDS ?? 300);
  let settled: { status: string; stellarClaimableBalanceId?: string; stellarClaimTransaction?: string; amountInTokens?: string } | undefined;
  for (let t = 0; t <= pollSec; t += 10) {
    settled = await api(`/ramp/order/${orderId}`);
    if (t % 30 === 0 || settled!.status !== 'funded') info(`[${t}s] status=${settled!.status}`);
    if (settled!.status === 'completed') break;
    if (['failed', 'cancelled'].includes(settled!.status)) throw new Error(`ordem terminou em ${settled!.status}`);
    await sleep(10_000);
  }
  if (settled!.status !== 'completed') {
    warn(`ordem parada em "${settled!.status}" após ${pollSec}s.`);
    warn('ISSO NÃO É BUG DA PLINA. O Pix foi aceito e a ordem foi financiada; quem não');
    warn('entregou o ativo on-chain foi o anchor. Observado em 2026-09-28: o mesmo fluxo');
    warn('liquidou em ~35s às 18:22 e parou de liquidar a partir das ~20:08 no sandbox.');
    warn('Reexecute mais tarde, ou suba SMOKE_POLL_SECONDS. Se persistir, é chamado pro fornecedor.');
    throw new Error(`anchor não liquidou a ordem (status=${settled!.status}) — falha do lado do fornecedor`);
  }
  ok(`completed — ${settled!.amountInTokens} ${bridge.symbol}`);
  out.settledOrder = settled;

  // ── 10. PROVA 1 ────────────────────────────────────────────────────────────
  step(10, 'PROVA 1 — o claimable balance existe no ledger');
  const cbId = settled!.stellarClaimableBalanceId;
  if (!cbId) throw new Error('anchor não devolveu stellarClaimableBalanceId');
  const cbRes = await fetch(`${horizon.serverURL.toString().replace(/\/$/, '')}/claimable_balances/${cbId}`);
  if (!cbRes.ok) throw new Error(`claimable balance ${cbId} não encontrado no Horizon (${cbRes.status})`);
  const cb = (await cbRes.json()) as { asset: string; amount: string; claimants: Array<{ destination: string }>; last_modified_ledger: number };
  ok(`${cb.amount} ${cb.asset.split(':')[0]} no ledger ${cb.last_modified_ledger}`);
  ok(`claimant = ${cb.claimants[0]?.destination === investor.publicKey() ? 'a carteira do investidor ✓' : cb.claimants[0]?.destination}`);
  proof(`${EXPLORER}/claimable-balance/${cbId}`);
  out.claimableBalance = { id: cbId, asset: cb.asset, amount: cb.amount, ledger: cb.last_modified_ledger };

  // ── 11. PROVA 2 ────────────────────────────────────────────────────────────
  step(11, 'PROVA 2 — investidor assina e submete o claim');
  const claimXdr = settled!.stellarClaimTransaction;
  if (!claimXdr) throw new Error('anchor não devolveu stellarClaimTransaction');
  const claimTx = new Transaction(claimXdr, networkPassphrase);
  info(`XDR do anchor traz ${claimTx.operations.length} operações: ${claimTx.operations.map((o) => o.type).join(' + ')}`);
  info('nota: buildClaimClaimableBalanceXdr (lib/stellar) monta só o claim, sem o changeTrust');
  claimTx.sign(investor);
  const claimRes = await horizon.submitTransaction(claimTx);
  ok(`claim submetido — ${claimRes.hash}`);
  proof(`${EXPLORER}/tx/${claimRes.hash}`);
  out.claimTxHash = claimRes.hash;

  // ── 12. PROVA 3 ────────────────────────────────────────────────────────────
  step(12, 'PROVA 3 — ativo-ponte creditado na carteira');
  const bridgeBalance = await getAssetBalance(investor.publicKey(), bridgeCode, bridgeIssuer);
  ok(`${bridgeBalance} ${bridgeCode} em ${investor.publicKey().slice(0, 8)}…`);
  if (Number(bridgeBalance) <= 0) throw new Error('saldo do ativo-ponte zerado após o claim');
  out.bridgeBalanceAfterClaim = bridgeBalance;

  // ── 13. trustline PLINARF ──────────────────────────────────────────────────
  step(13, `Preparar carteira para ${assetCode}: XLM + trustline + autorização`);
  const issuer = issuerSigner();
  const distributor = distributorSigner();
  const investorSigner = new KeypairSigner(investor.secret());

  // O anchor deixa a carteira com o mínimo: reserva base + a trustline do
  // ativo-ponte. Uma segunda trustline (PLINARF) exige +0.5 XLM de reserva,
  // que o investidor não tem. Em produção quem cobre isso é o funder da Plina.
  const acct = await horizon.loadAccount(investor.publicKey());
  const xlm = acct.balances.find((b) => b.asset_type === 'native')?.balance ?? '0';
  info(`carteira tem ${xlm} XLM após o patrocínio do anchor`);
  const topUp = new TransactionBuilder(await horizon.loadAccount(issuer.publicKey()), {
    fee: '10000',
    networkPassphrase,
  })
    .addOperation(Operation.payment({ destination: investor.publicKey(), asset: Asset.native(), amount: '5' }))
    .setTimeout(60)
    .build();
  issuer.sign(topUp);
  await horizon.submitTransaction(topUp);
  ok('aporte de 5 XLM — cobre a reserva da segunda trustline e as fees');

  await createTrustline(investorSigner, issuer.publicKey(), assetCode);
  ok(`trustline ${assetCode} criada pelo investidor`);
  await authorizeTrustline(issuer, investor.publicKey(), assetCode);
  ok('issuer autorizou — sem isso o investidor não pode receber o ativo');

  // ── 14. PROVA 4 ────────────────────────────────────────────────────────────
  step(14, `PROVA 4 — swap atômico ${bridgeCode} → ${assetCode} (2 pernas, 1 tx)`);
  const swapBridgeAmount = process.env.SMOKE_SWAP_BRIDGE ?? bridgeBalance;
  const plinarfAmount = process.env.SMOKE_SWAP_PLINARF ?? BRL; // 1 PLINA-RF = R$ 1,00
  const distributorHas = await getAssetBalance(distributor.publicKey(), assetCode, issuer.publicKey());
  info(`distributor tem ${distributorHas} ${assetCode}; swap pede ${plinarfAmount}`);
  if (Number(distributorHas) < Number(plinarfAmount)) {
    throw new Error(`distributor sem saldo suficiente de ${assetCode} (tem ${distributorHas}, precisa ${plinarfAmount})`);
  }
  const { xdr: swapXdr } = await buildSwapBridgeForPlinarfXdr({
    investorPubkey: investor.publicKey(),
    bridgeAsset: buildAsset(bridgeIssuer, bridgeCode),
    bridgeAmount: swapBridgeAmount,
    plinarfAmount,
    issuerPubkey: issuer.publicKey(),
    distributorPubkey: distributor.publicKey(),
    memo: 'smoke-investidor',
  });
  const swapTx = new Transaction(swapXdr, networkPassphrase);
  swapTx.sign(investor);          // perna 1: investidor → distributor (ativo-ponte)
  distributor.sign(swapTx);       // perna 2: distributor → investidor (PLINARF)
  const swapRes = await horizon.submitTransaction(swapTx);
  ok(`swap submetido — ${swapRes.hash}`);
  info('as duas pernas passam ou nenhuma passa: sem risco de slippage ou de perna órfã');
  proof(`${EXPLORER}/tx/${swapRes.hash}`);
  out.swapTxHash = swapRes.hash;

  // ── 15. PROVA 5 ────────────────────────────────────────────────────────────
  step(15, `PROVA 5 — ${assetCode} creditado na carteira do investidor`);
  const plinarfBalance = await getAssetBalance(investor.publicKey(), assetCode, issuer.publicKey());
  ok(`${plinarfBalance} ${assetCode}`);
  if (Number(plinarfBalance) <= 0) throw new Error(`saldo de ${assetCode} zerado após o swap`);
  out.plinarfBalance = plinarfBalance;

  // ── resumo ─────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(72));
  console.log('CADEIA COMPLETA PROVADA — Pix → anchor → ativo-ponte → swap → PLINA-RF');
  console.log('═'.repeat(72));
  console.log(`  Pix (simulado em sandbox)  R$ ${BRL}`);
  console.log(`  Ativo-ponte recebido       ${bridgeBalance} ${bridgeCode}`);
  console.log(`  PLINA-RF recebido          ${plinarfBalance} ${assetCode}`);
  console.log('\n  Verificável por terceiros:');
  console.log(`    carteira  ${EXPLORER}/account/${investor.publicKey()}`);
  console.log(`    claim     ${EXPLORER}/tx/${out.claimTxHash}`);
  console.log(`    swap      ${EXPLORER}/tx/${out.swapTxHash}`);

  out.finishedAt = new Date().toISOString();
  writeFileSync('smoke-investidor-output.json', JSON.stringify(out, null, 2));
  console.log('\n✓ Smoke verde. Output em smoke-investidor-output.json (NÃO commitar).');
}

main().catch((e) => {
  console.error(`\n✗ Smoke falhou: ${e instanceof Error ? e.message : String(e)}`);
  out.error = e instanceof Error ? e.message : String(e);
  writeFileSync('smoke-investidor-output.json', JSON.stringify(out, null, 2));
  process.exit(1);
});
