/**
 * Smoke do CICLO completo (E3-2) — só TESTNET, Postgres DESCARTÁVEL, contas NOVAS (friendbot), Pix SIMULADO.
 *   pnpm smoke:ciclo
 *
 * Roda o código de produção (serviços e `lib/stellar/*`) na ordem do produto e imprime o link do Stellar Expert de cada
 * passo on-chain: ORIGINAR (lead → oferta → cessão → laudo → anuência → titular → Pix ao cedente) → EMITIR (cota) → INVESTIR
 * (swap atômico TESOURO → PLINARF) → RESGATAR (investidor devolve PLINARF) → REALIZAR (comprador, Caminho A). Cada perna roda
 * DE NOVO e tem de devolver a mesma tx, sem duplicar emissão, pagamento nem âncora; a emissão também prova a RECUPERAÇÃO
 * (queda depois da chain, antes do banco). Sem PII na saída: só ids, hashes e links.
 *
 * Não usa o Neon, nenhuma chave do projeto nem .env.local. Precisa de Docker (ou SMOKE_CICLO_PG_URL com um Postgres
 * local vazio) e de rede para o friendbot/Horizon da testnet. Ver ops/runbooks/smoke-ciclo.md.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { instalarBlobEmMemoria, instalarTesouroDescartavel } from './smoke-ciclo/blob-stub';
import { subirBanco, type BancoDescartavel } from './smoke-ciclo/pg';

const OPERADOR = 'smoke-ciclo';
const ok = (m: string) => console.log(`  ✓ ${m}`);
const info = (m: string) => console.log(`  · ${m}`);
const titulo = (n: number, total: number, t: string) => console.log(`\n━━━ [${n}/${total}] ${t}`);

class Falha extends Error {}
function exigir(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Falha(msg);
}

/** CPF de teste com dígitos verificadores válidos, gerado ao acaso: nunca é de uma pessoa conhecida e nunca é impresso. */
function cpfDeTeste(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (new Set(base).size === 1) base[0] = (base[0]! + 1) % 10;
  const dv = (d: number[]) => {
    const r = d.reduce((acc, n, i) => acc + n * (d.length + 1 - i), 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

const TOTAL = 7;

async function main() {
  // ── 0. Ambiente do smoke: tudo definido AQUI, antes de importar qualquer serviço ─────────────────────────────────
  if ((process.env.STELLAR_NETWORK ?? 'TESTNET').trim().toUpperCase() === 'PUBLIC') throw new Falha('smoke só roda em TESTNET');
  process.env.STELLAR_NETWORK = 'TESTNET';
  for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'ASAAS_API_KEY', 'FIREBLOCKS_API_KEY', 'FIREBLOCKS_API_SECRET', 'STELLAR_FUNDER_SECRET', 'VERCEL', 'VERCEL_ENV']) delete process.env[k];
  Object.assign(process.env, {
    PSP_PROVIDER: 'SIMULADO',
    PIX_MAX_BRL: '1000000',
    TITULAR_HMAC_SECRET: randomBytes(24).toString('hex'),
    ETHERFUSE_ENV: 'sandbox',
    OPS_CRON_SECRET: randomBytes(24).toString('hex'),
    NODE_ENV: 'test',
    E2E_STUB: '1',
    PRIVY_VERIFY_STUB: 'true',
    ASSET_CODE: 'PLINARF',
    BLOB_READ_WRITE_TOKEN: 'token-ficticio-do-smoke', // o código exige um token; o `put` real é trocado pela memória local (blob-stub)
  });
  const blob = instalarBlobEmMemoria();
  // Dois avisos de log do código real são esperados aqui e só confundem quem lê: a janela NAV→submit da testnet (rede lenta) e
  // o "retry pós sucesso" do swap (é justamente a idempotência que o smoke testa). Qualquer outro erro continua aparecendo.
  const logErroOriginal = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const t = typeof args[0] === 'string' ? args[0] : '';
    if (t.startsWith('[liquidacao] janela NAV') || t.startsWith('[swap/submit] idempotente')) return;
    logErroOriginal(...args);
  };

  console.log('Smoke do ciclo — TESTNET · Postgres descartável · contas novas · Pix SIMULADO');
  const banco: BancoDescartavel = await subirBanco();
  const encerrar = () => banco.encerrar();
  process.on('exit', encerrar);
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));
  process.env.DATABASE_URL = banco.url;
  process.env.DIRECT_URL = banco.url;
  ok(`banco descartável (${banco.origem}), migrations aplicadas`);

  // ── 1. Contas novas da testnet (nenhuma chave do projeto) ─────────────────────────────────────────────────────────
  const { createFundedAccount } = await import('../lib/stellar/account');
  const { txExplorerUrl, accountExplorerUrl } = await import('../lib/stellar/config');
  const [issuer, distributor, posicao, investidor, tesouroIssuer, comprador] = await Promise.all(Array.from({ length: 6 }, () => createFundedAccount()));
  Object.assign(process.env, {
    STELLAR_ISSUER_SECRET: issuer!.secret(),
    STELLAR_ISSUER_PUBLIC: issuer!.publicKey(),
    STELLAR_DISTRIBUTOR_SECRET: distributor!.secret(),
    STELLAR_DISTRIBUTOR_PUBLIC: distributor!.publicKey(),
    STELLAR_PLINA_POSITION_PUBLIC: posicao!.publicKey(),
    STELLAR_PLINA_POSITION_SECRET: posicao!.secret(),
  });
  const { KeypairSigner, issuerSigner } = await import('../lib/stellar/signer');
  const { configureIssuerFlags, createTrustline, authorizeTrustline } = await import('../lib/stellar/issuer');
  await configureIssuerFlags(issuerSigner());
  await createTrustline(new KeypairSigner(posicao!.secret()), issuer!.publicKey());
  await authorizeTrustline(issuerSigner(), posicao!.publicKey());
  ok(`issuer ${accountExplorerUrl(issuer!.publicKey())} (AUTH_REQUIRED + REVOCABLE + CLAWBACK); posição da Plina autorizada`);

  const { db } = await import('../lib/db');
  const { horizon, getAssetBalance } = await import('../lib/stellar/account');
  const { networkPassphrase } = await import('../lib/stellar/config');
  const o = await import('../lib/services/originacao');
  const real = await import('../lib/services/realizacao');
  const { confirmarTitularDoLaudo } = await import('../lib/services/titular-laudo');
  const { pagarCedenteDaCessao } = await import('../lib/services/pagamento-cedente');
  const { buildLiquidarPlinarfXdr, submitLiquidacao } = await import('../lib/services/liquidacao');
  const { fetchSupplyDasClasses } = await import('../lib/stellar/supply');
  const { Asset, Keypair, Operation, TransactionBuilder, Transaction, BASE_FEE } = await import('@stellar/stellar-sdk');
  const { NextRequest } = await import('next/server');
  const { Prisma } = await import('@prisma/client');

  const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const link = (h: string) => txExplorerUrl(h);
  const supplyTotal = async () => (await fetchSupplyDasClasses()).senior.totalEmitido;
  /** Quantas âncoras (tx do distributor com Memo.hash = SHA-256) existem na rede para este hash. */
  async function contarAncoras(sha256Hex: string): Promise<number> {
    const memo = Buffer.from(sha256Hex, 'hex').toString('base64');
    const pag = await horizon.transactions().forAccount(distributor!.publicKey()).order('desc').limit(200).call();
    return pag.records.filter((t) => t.memo_type === 'hash' && t.memo === memo && t.successful).length;
  }
  async function pagarAtivo(de: InstanceType<typeof Keypair>, para: string, code: string, valor: string) {
    const conta = await horizon.loadAccount(de.publicKey());
    const tx = new TransactionBuilder(conta, { fee: BASE_FEE, networkPassphrase })
      .addOperation(Operation.payment({ destination: para, asset: new Asset(code, de.publicKey()), amount: valor }))
      .setTimeout(60)
      .build();
    tx.sign(de);
    return horizon.submitTransaction(tx);
  }

  // Falha injetada no banco descartável: INSERT de Cota recusado = "o processo caiu depois da chain, antes do banco".
  await db.$executeRawUnsafe('CREATE TABLE smoke_falha (ativo boolean NOT NULL)');
  await db.$executeRawUnsafe("CREATE FUNCTION smoke_bloqueia_cota() RETURNS trigger AS $$ BEGIN IF EXISTS (SELECT 1 FROM smoke_falha WHERE ativo) THEN RAISE EXCEPTION 'smoke: falha injetada depois da chain'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql");
  await db.$executeRawUnsafe('CREATE TRIGGER smoke_cota BEFORE INSERT ON "Cota" FOR EACH ROW EXECUTE FUNCTION smoke_bloqueia_cota()');

  // ── 2. ORIGINAR (usado duas vezes: cessão A do ciclo e cessão B da recuperação) ──────────────────────────────────
  async function originar(rotulo: string, verbose: boolean) {
    const sufixo = randomBytes(4).toString('hex');
    const cedente = await db.pessoa.create({
      data: {
        privyId: `smoke-ciclo-${rotulo}-${sufixo}`,
        email: `cedente-${rotulo}-${sufixo}@example.invalid`,
        nome: 'Cedente de Teste',
        publicKey: Keypair.random().publicKey(),
        kycStatus: 'APROVADO',
        kycAprovado: true,
        cpfNormalizado: cpfDeTeste(),
        isSyntheticCpf: true,
      },
    });
    const lead = await o.capturarLead({ nome: 'Cedente de Teste', email: cedente.email, consentimentoLgpd: true, pessoaId: cedente.id, origem: 'smoke-ciclo' });
    if (verbose) ok(`lead — ${link(lead.txHash)}`);
    const oferta = await o.gerarOferta({ leadVendedorId: lead.leadId, tipoBem: 'IMOVEL', valorCarta: '100000', administradora: 'Administradora de Teste', desagioAquisicao: '0.20', prazoRestanteMeses: 12, operador: OPERADOR });
    await o.aceitarOferta(oferta.id, cedente.id);
    const cessao = await o.registrarCessao({ ofertaId: oferta.id, operador: OPERADOR });
    if (verbose) ok(`cessão assinada — ${link(cessao.txHash)}`);
    const laudo = await o.registrarLaudoDaCessao({ cessaoId: cessao.cessaoId, laudoUrl: `https://example.org/smoke-ciclo/laudo-${rotulo}-${sufixo}.pdf`, operador: OPERADOR });
    if (verbose) ok(`laudo da cessão ancorado — ${link(laudo.txHash)}`);
    await o.registrarAnuencia({ hashValidacao: laudo.hashValidacao, status: 'DECLARADA_PENDENTE', operador: OPERADOR });
    if (verbose) ok('anuência registrada como DECLARADA_PENDENTE (só testnet; não finge ser a real)');
    await confirmarTitularDoLaudo({ cessaoId: cessao.cessaoId, situacao: 'TITULAR_UNICO', atestado: true, operador: OPERADOR });
    if (verbose) ok('titular do laudo atestado (HMAC do CPF, nunca o CPF)');
    const pago = await pagarCedenteDaCessao({ cessaoId: cessao.cessaoId, operador: OPERADOR });
    exigir(pago.status === 'COMPROVADA' && pago.txHash && pago.sha256, `Pix ao cedente não comprovado (${pago.status})`);
    if (verbose) ok(`Pix SIMULADO comprovado; SHA-256 do comprovante ${pago.sha256} — âncora ${link(pago.txHash)}`);
    return { cessaoId: cessao.cessaoId, pagoTx: pago.txHash!, pagoSha: pago.sha256! };
  }

  titulo(1, TOTAL, 'ORIGINAR — cedente (KYC aprovado, CPF sintético) → lead → oferta → cessão → laudo → anuência → titular → Pix SIMULADO');
  const A = await originar('a', true);
  const ancorasPix = await contarAncoras(A.pagoSha);
  exigir(ancorasPix === 1, `esperava 1 âncora do comprovante, achei ${ancorasPix}`);
  let pagouDeNovo = false;
  try {
    const again = await pagarCedenteDaCessao({ cessaoId: A.cessaoId, operador: OPERADOR });
    pagouDeNovo = again.txHash !== A.pagoTx || again.sha256 !== A.pagoSha; // devolver o MESMO estado também vale
  } catch {
    /* recusado porque já foi pago: é o esperado */
  }
  exigir(!pagouDeNovo && (await contarAncoras(A.pagoSha)) === 1 && (await db.transferenciaPix.count({ where: { cessaoId: A.cessaoId } })) === 1, 're-executar o pagamento duplicou envio ou âncora');
  ok('re-executar o pagamento: recusado/mesmo estado, 1 âncora na rede, 1 TransferenciaPix (nada duplicado)');

  // ── 3. EMITIR ─────────────────────────────────────────────────────────────────────────────────────────────────
  titulo(2, TOTAL, 'EMITIR — incorporar a cota (PLINARF emitido pelo issuer à posição da Plina)');
  const supply0 = await supplyTotal();
  const cotaA = await o.incorporarCotaDoFunil({ cessaoId: A.cessaoId, desagioRevenda: '0.10', operador: OPERADOR });
  ok(`cota ${cotaA.cotaId}: ${cotaA.tokensEmitidos} PLINARF emitidos — ${link(cotaA.txHash)}`);
  const supply1 = await supplyTotal();
  exigir(supply1.minus(supply0).eq(new Prisma.Decimal(cotaA.tokensEmitidos)), 'a rede não mostra exatamente a emissão da cota');
  ok(`supply na rede: ${supply0.toFixed(7)} → ${supply1.toFixed(7)} (= tokens da cota)`);
  let recusou = false;
  try {
    await o.incorporarCotaDoFunil({ cessaoId: A.cessaoId, desagioRevenda: '0.10', operador: OPERADOR });
  } catch {
    recusou = true;
  }
  exigir(recusou && (await db.cota.count()) === 1 && (await supplyTotal()).eq(supply1), 're-executar a emissão duplicou cota ou token');
  ok('re-executar a emissão: recusada, 1 cota, supply igual (nada duplicado)');

  // ── 4. RECUPERAÇÃO da emissão (cessão B) ──────────────────────────────────────────────────────────────────────
  titulo(3, TOTAL, 'RECUPERAR — a emissão entra na rede, o banco cai antes de gravar; a reexecução acha a tx pelo memo');
  const B = await originar('b', false);
  ok(`cessão B pronta (Pix SIMULADO ancorado — ${link(B.pagoTx)})`);
  await db.$executeRawUnsafe('INSERT INTO smoke_falha (ativo) VALUES (true)');
  let caiu = false;
  try {
    await o.incorporarCotaDoFunil({ cessaoId: B.cessaoId, desagioRevenda: '0.10', operador: OPERADOR });
  } catch {
    caiu = true;
  }
  const supply2 = await supplyTotal();
  exigir(caiu && (await db.cota.count()) === 1, 'a falha injetada não derrubou a gravação da cota B');
  exigir(supply2.gt(supply1), 'a emissão da cota B não chegou à rede antes da queda');
  ok(`banco caiu na gravação: 1 cota no banco, mas a rede já mostra a emissão (supply ${supply2.toFixed(7)})`);
  await db.$executeRawUnsafe('UPDATE smoke_falha SET ativo = false');
  const cotaB = await o.incorporarCotaDoFunil({ cessaoId: B.cessaoId, desagioRevenda: '0.10', operador: OPERADOR });
  exigir((await supplyTotal()).eq(supply2), 'a recuperação emitiu de novo (supply cresceu)');
  const evB = await db.eventoAudit.findFirst({ where: { acao: 'COTA_INCORPORADA', cotaId: cotaB.cotaId } });
  exigir((evB?.payloadJson as { recuperadaPorMemo?: boolean } | null)?.recuperadaPorMemo === true, 'a cota B não foi marcada como recuperada pelo memo');
  exigir((await db.cota.count()) === 2, 'esperava 2 cotas depois da recuperação');
  ok(`recuperada pelo memo, sem nova emissão: cota ${cotaB.cotaId} — ${link(cotaB.txHash)}`);

  // ── 5. INVESTIR ───────────────────────────────────────────────────────────────────────────────────────────────
  titulo(4, TOTAL, 'INVESTIR — swap atômico TESOURO → PLINARF (investidor assina; issuer co-assina no submit)');
  instalarTesouroDescartavel('TESOURO', tesouroIssuer!.publicKey());
  const inv = investidor!;
  const invSigner = new KeypairSigner(inv.secret());
  await createTrustline(invSigner, issuer!.publicKey());
  await authorizeTrustline(issuerSigner(), inv.publicKey());
  await createTrustline(invSigner, tesouroIssuer!.publicKey(), 'TESOURO');
  const pagTesouro = await pagarAtivo(tesouroIssuer!, inv.publicKey(), 'TESOURO', '1000.0000000');
  const distSigner = new KeypairSigner(distributor!.secret());
  await createTrustline(distSigner, issuer!.publicKey()); // o distributor recebe PLINARF no resgate
  await authorizeTrustline(issuerSigner(), distributor!.publicKey());
  ok(`investidor com trustline PLINARF autorizada e 1000 TESOURO (ativo-ponte descartável) — ${link(pagTesouro.hash)}`);
  const investidorRow = await db.investidor.create({
    data: { nome: 'Investidor de Teste', email: 'investidor@example.invalid', publicKey: inv.publicKey(), privyId: `did:privy:e2e-${inv.publicKey()}`, kycAprovado: true, status: 'AUTORIZADO', isSyntheticCpf: true },
  });
  const quoteId = randomUUID();
  await db.quote.create({
    data: { id: quoteId, investidorId: investidorRow.id, fromCurrency: 'BRL', fromAmount: '1000.00', toCurrency: 'TESOURO', toAmount: '1000.0000000', exchangeRate: '1', fee: '0', expiresAt: new Date(Date.now() + 15 * 60_000), classe: 'SENIOR' },
  });
  await db.onRampOrder.create({ data: { id: randomUUID(), quoteId, investidorId: investidorRow.id, status: 'completed' } });
  const chamar = async (rota: string, handler: (req: InstanceType<typeof NextRequest>, ctx: unknown) => Promise<Response>, corpo: unknown) => {
    const req = new NextRequest(`http://localhost${rota}`, { method: 'POST', headers: { authorization: `Bearer e2e-stub-${inv.publicKey()}`, 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
    const r = await handler(req, { params: Promise.resolve({}) });
    const j = (await r.json()) as Record<string, unknown>;
    return { status: r.status, corpo: ((j.data as Record<string, unknown> | undefined) ?? j) as Record<string, unknown> };
  };
  const { POST: swapBuild } = await import('../app/api/investidor/buy/swap/build/route');
  const { POST: swapSubmit } = await import('../app/api/investidor/buy/swap/submit/route');
  const build = await chamar('/api/investidor/buy/swap/build', swapBuild as never, { quoteId, investorPubkey: inv.publicKey() });
  exigir(build.status === 200 && typeof build.corpo.xdr === 'string', `swap/build recusou (${build.status}): ${JSON.stringify(build.corpo).slice(0, 200)}`);
  const plinarfComprado = String(build.corpo.plinarfAmount);
  const txSwap = new Transaction(build.corpo.xdr as string, networkPassphrase);
  txSwap.sign(inv);
  const signedXdr = txSwap.toXDR();
  const saldoAntes = await getAssetBalance(inv.publicKey(), 'PLINARF', issuer!.publicKey());
  const sub = await chamar('/api/investidor/buy/swap/submit', swapSubmit as never, { quoteId, signedXdr });
  exigir(sub.status === 200 && typeof sub.corpo.swapTxHash === 'string', `swap/submit recusou (${sub.status}): ${JSON.stringify(sub.corpo).slice(0, 200)}`);
  const swapTx = sub.corpo.swapTxHash as string;
  const saldoDepois = await getAssetBalance(inv.publicKey(), 'PLINARF', issuer!.publicKey());
  exigir(new Prisma.Decimal(saldoDepois).minus(saldoAntes).eq(new Prisma.Decimal(plinarfComprado)), 'o investidor não recebeu o PLINARF da cotação');
  ok(`swap executado: 1000 TESOURO → ${plinarfComprado} PLINARF (emissão nova pelo issuer) — ${link(swapTx)}`);
  const supply3 = await supplyTotal();
  const sub2 = await chamar('/api/investidor/buy/swap/submit', swapSubmit as never, { quoteId, signedXdr });
  exigir(sub2.status === 200 && sub2.corpo.swapTxHash === swapTx && sub2.corpo.idempotent === true, 'reenviar o mesmo swap não foi idempotente');
  exigir((await supplyTotal()).eq(supply3) && (await db.movimentoFundo.count({ where: { tipo: 'SUBSCRICAO' } })) === 1, 'reenviar o swap duplicou emissão ou escrituração');
  ok('re-executar o swap: mesma tx (idempotent), supply igual, 1 escrituração de SUBSCRICAO');

  // ── 6. RESGATAR ───────────────────────────────────────────────────────────────────────────────────────────────
  titulo(5, TOTAL, 'RESGATAR — o investidor devolve PLINARF ao distributor (BRL simulado no MVP testnet)');
  const quantia = new Prisma.Decimal(plinarfComprado).div(2).toFixed(7);
  const liq = await buildLiquidarPlinarfXdr({ investorPubkey: inv.publicKey(), amount: quantia });
  const txLiq = new Transaction(liq.xdr, networkPassphrase);
  const assinatura = `0x${inv.sign(txLiq.hash()).toString('hex')}`;
  const entrada = { xdr: liq.xdr, investorPubkey: inv.publicKey(), signatureHex: assinatura, investidorId: investidorRow.id, privyId: investidorRow.privyId! };
  const r1 = await submitLiquidacao(entrada);
  ok(`resgate de ${quantia} PLINARF (≈ R$ ${r1.brlEquivalente}) — ${link(r1.liquidationTxHash)}; auditoria ancorada — ${link(r1.auditTxHash)}`);
  const r2 = await submitLiquidacao(entrada);
  exigir(r2.liquidationTxHash === r1.liquidationTxHash, 'reenviar o resgate gerou outra tx');
  exigir((await db.eventoAudit.count({ where: { acao: 'PLINARF_LIQUIDADO' } })) === 1, 'reenviar o resgate duplicou a auditoria');
  ok('re-executar o resgate: mesma tx, 1 auditoria PLINARF_LIQUIDADO (nada duplicado)');

  // ── 7. REALIZAR ───────────────────────────────────────────────────────────────────────────────────────────────
  titulo(6, TOTAL, 'REALIZAR — comprador reserva a cota A e a realização (Caminho A) entra no razão');
  const sufC = randomBytes(4).toString('hex');
  const leadC = await real.capturarLeadComprador({ nome: 'Comprador de Teste', email: `comprador-${sufC}@example.invalid`, tipo: 'PESSOA_FISICA', consentimentoLgpd: true, origem: 'smoke-ciclo' });
  ok(`lead comprador — ${link(leadC.txHash)}`);
  const reserva = await real.criarReserva({ cotaId: cotaA.cotaId, leadCompradorId: leadC.leadId });
  ok(`reserva criada — ${link(reserva.txHash)}`);
  const realizada = await real.executarCaminhoA({ reservaId: reserva.reservaId, valorRealizado: '90000.00', operador: OPERADOR });
  ok(`realização: spread R$ ${realizada.spread} — ${link(realizada.txHash)}`);
  let dup = false;
  try {
    await real.executarCaminhoA({ reservaId: reserva.reservaId, valorRealizado: '90000.00', operador: OPERADOR });
  } catch {
    dup = true;
  }
  exigir(dup && (await db.realizacaoCaminho.count()) === 1 && (await db.movimentoFundo.count({ where: { tipo: 'REALIZACAO' } })) === 1, 're-executar a realização duplicou o razão');
  ok('re-executar a realização: recusada, 1 realização, 1 movimento REALIZACAO (nada duplicado)');

  // ── 8. RECONCILIAÇÃO ──────────────────────────────────────────────────────────────────────────────────────────
  titulo(7, TOTAL, 'RECONCILIAR — o que o banco diz = o que a rede diz');
  const cotas = await db.cota.findMany({ select: { tokensEmitidos: true } });
  const esperado = cotas.reduce((s, c) => s.plus(c.tokensEmitidos), new Prisma.Decimal(0)).plus(plinarfComprado);
  const supplyFinal = await supplyTotal();
  exigir(supplyFinal.eq(esperado), `supply na rede ${supplyFinal.toFixed(7)} ≠ cotas + subscrição ${esperado.toFixed(7)}`);
  ok(`supply PLINARF na rede ${supplyFinal.toFixed(7)} = tokens das 2 cotas + subscrição (nenhuma emissão duplicada ou perdida)`);
  const holding = await db.holdingPLINARF.findFirst({ where: { investidorId: investidorRow.id } });
  const saldoRede = await getAssetBalance(inv.publicKey(), 'PLINARF', issuer!.publicKey());
  exigir(holding && new Prisma.Decimal(holding.saldo).eq(new Prisma.Decimal(saldoRede)), 'a posição do investidor no banco ≠ saldo na rede');
  ok(`posição do investidor: banco = rede = ${saldoRede}`);
  const porAcao = await db.eventoAudit.groupBy({ by: ['acao'], _count: true });
  info(`auditoria: ${porAcao.map((g) => `${g.acao}×${g._count}`).join(', ')}`);
  console.log(`\nOK — ciclo completo na testnet; banco descartável removido; ${blob.arquivos.size} comprovante(s) no Blob em memória.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nFALHOU:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
