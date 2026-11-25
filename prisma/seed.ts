/**
 * Seed do POC — bootstrap da demo.
 *
 * Cria ParametrosPool (singleton) + 3 cotas representativas (imóvel, veículo,
 * equipamento) com emissão real on-chain antes de persistir no DB. Respeita
 * a key rule do CLAUDE.md: "DB só atualiza APÓS sucesso on-chain."
 *
 * Idempotente contra o banco **e contra o ledger**. O issuer da testnet é
 * compartilhado por todo banco que roda o seed, então pular a cota que já está
 * no banco não basta: em 16/11/2026 um banco vazio reemitiu as 3 cotas duas
 * vezes e /pool publicou NAV/token de -R$ 19.409. Para cada cota
 * (`decidirEmissaoDoSeed`, lib/services/seed-emissao.ts):
 *
 *   1. Já existe no banco (por `notas`): pula.
 *   2. O ledger já tem a emissão do seed (`Memo.hash` por cota): adota o hash
 *      e grava, sem cunhar de novo.
 *   3. O ledger tem PLINARF que o razão deste banco não registra: recusa.
 *   4. Senão emite, com o memo, e grava.
 *
 * Grava a cota, os eventos e o `MovimentoFundo` APORTE_COTA na mesma
 * transação (mesma chave do backfill), para o razão acompanhar o ledger e o
 * gate do NAV (SUPPLY_SEM_LASTRO) não fechar depois de um seed.
 *
 * Pré-requisito: STELLAR_ISSUER_SECRET + STELLAR_DISTRIBUTOR_PUBLIC no
 * .env.local (vem do smoke-stellar inicial). Distributor precisa ter
 * trustline AUTHORIZED pra PLINARF (o smoke já fez isso).
 *
 * Rodar:  npm run prisma:seed
 */

import { PrismaClient, TipoBem, CaminhoRealizacao } from '@prisma/client';
import { carregarEnv } from '../scripts/lib/carregar-env';
import { issueAsset } from '../lib/stellar/issuer';
import { KeypairSigner } from '../lib/stellar/signer';
import {
  accountExplorerUrl,
  assetCode,
  txExplorerUrl,
} from '../lib/stellar/config';
import {
  navDaCotaAsDecimal,
  supplyEmitidoParaNavAsDecimal,
  tokensParaEmitir,
} from '../lib/services/pool';
import { registrarMovimentoFundo } from '../lib/services/razao-fundo';
import { decidirEmissaoDoSeed, memoHashDoSeed } from '../lib/services/seed-emissao';
import { buscarEmissaoPorMemo } from '../lib/stellar/issuer';
import { fetchSupplyOnChain } from '../lib/stellar/supply';

carregarEnv(); // linha de comando > .env.local > .env (A-13)

const prisma = new PrismaClient();

interface CotaSeed {
  slug: string;
  tipoBem: TipoBem;
  administradora: string;
  valorCarta: string;
  desagioAquisicao: string;
  desagioRevenda: string;
  localizacaoAprox: string;
  prazoRestanteMeses: number;
  caminhoPrevisto: CaminhoRealizacao;
  notas: string;
}

const COTAS: CotaSeed[] = [
  {
    slug: 'imovel-sp-250k',
    tipoBem: 'IMOVEL',
    administradora: 'Porto Real Consórcios',
    valorCarta: '250000.00',
    desagioAquisicao: '0.1800',
    desagioRevenda: '0.1000',
    localizacaoAprox: 'São Paulo - SP',
    prazoRestanteMeses: 18,
    caminhoPrevisto: 'A_REVENDA',
    notas: 'demo-seed:imovel',
  },
  {
    slug: 'veiculo-mg-80k',
    tipoBem: 'VEICULO',
    administradora: 'Embracon Consórcios',
    valorCarta: '80000.00',
    desagioAquisicao: '0.2200',
    desagioRevenda: '0.1200',
    localizacaoAprox: 'Belo Horizonte - MG',
    prazoRestanteMeses: 12,
    caminhoPrevisto: 'A_REVENDA',
    notas: 'demo-seed:veiculo',
  },
  {
    slug: 'equipamento-rs-150k',
    tipoBem: 'EQUIPAMENTO',
    administradora: 'Bradesco Consórcios',
    valorCarta: '150000.00',
    desagioAquisicao: '0.2000',
    desagioRevenda: '0.1100',
    localizacaoAprox: 'Porto Alegre - RS',
    prazoRestanteMeses: 24,
    caminhoPrevisto: 'A_REVENDA',
    notas: 'demo-seed:equipamento',
  },
];

async function ensureParametrosPool() {
  const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
  const distributorPubkey = process.env.STELLAR_DISTRIBUTOR_PUBLIC;
  if (!issuerPubkey || !distributorPubkey) {
    throw new Error(
      'STELLAR_ISSUER_PUBLIC e STELLAR_DISTRIBUTOR_PUBLIC precisam estar em .env.local.',
    );
  }

  await prisma.parametrosPool.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      assetCode,
      issuerPubkey,
      distributorPubkey,
      network: 'TESTNET',
      homeDomain: 'plina.finance',
      policyUrl: 'https://plina.finance/politica-clawback',
    },
    update: {
      assetCode,
      issuerPubkey,
      distributorPubkey,
      homeDomain: 'plina.finance',
      policyUrl: 'https://plina.finance/politica-clawback',
    },
  });
  console.log('     ✓ ParametrosPool singleton ok');
  console.log(`       issuer: ${accountExplorerUrl(issuerPubkey)}`);
  console.log(`       distributor: ${accountExplorerUrl(distributorPubkey)}`);
}

async function seedCota(cota: CotaSeed) {
  // Match por substring `notas` — idempotência.
  const existing = await prisma.cota.findFirst({
    where: { notas: cota.notas },
  });
  if (existing) {
    console.log(`     · ${cota.slug} já existe (id=${existing.id}), skip.`);
    return;
  }

  const issuerSecret = process.env.STELLAR_ISSUER_SECRET;
  const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
  const distributorPubkey = process.env.STELLAR_DISTRIBUTOR_PUBLIC;
  if (!issuerSecret || !issuerPubkey || !distributorPubkey) {
    throw new Error(
      'STELLAR_ISSUER_SECRET + STELLAR_ISSUER_PUBLIC + STELLAR_DISTRIBUTOR_PUBLIC obrigatórios.',
    );
  }

  const quantity = tokensParaEmitir({
    valorCarta: cota.valorCarta,
    desagioAquisicao: cota.desagioAquisicao,
  });
  const quantityStr = quantity.toFixed(7);
  const memoHash = memoHashDoSeed(cota.slug, assetCode);

  // Outro banco pode ter rodado o seed contra o mesmo issuer: a decisão olha o
  // ledger (memo da cota e supply sem lastro), não só este banco.
  const [existente, supply, razao] = await Promise.all([
    buscarEmissaoPorMemo({ code: assetCode, destination: distributorPubkey, memoHash }),
    fetchSupplyOnChain({ issuerPubkey, distributorPubkey, code: assetCode }),
    prisma.movimentoFundo.aggregate({ _sum: { deltaTokens: true } }),
  ]);
  const decisao = decidirEmissaoDoSeed({
    slug: cota.slug,
    code: assetCode,
    quantidade: quantityStr,
    existente,
    emitidoNoLedger: supplyEmitidoParaNavAsDecimal(supply),
    noRazao: razao._sum.deltaTokens ?? 0,
  });

  let emissaoTxHash: string;
  if (decisao.acao === 'recusar') {
    throw new Error(`Recusado: ${decisao.motivo}`);
  } else if (decisao.acao === 'adotar') {
    emissaoTxHash = decisao.txHash;
    console.log(`     · ${cota.slug} já emitida no ledger, adotando a emissão existente.`);
  } else {
    // Emite on-chain ANTES de persistir no DB (key rule CLAUDE.md), com o memo
    // que permite reencontrar a emissão sem o banco.
    console.log(`     · emitindo ${quantityStr} ${assetCode} pra distributor...`);
    const emissionRes = await issueAsset(
      new KeypairSigner(issuerSecret),
      distributorPubkey,
      quantityStr,
      assetCode,
      { memoHash },
    );
    emissaoTxHash = emissionRes.hash;
  }
  console.log(`       tx: ${txExplorerUrl(emissaoTxHash)}`);

  // Sucesso on-chain (ou emissão adotada) → cota, eventos e razão juntos.
  const adotada = decisao.acao === 'adotar';
  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.cota.create({
      data: {
        tipoBem: cota.tipoBem,
        administradora: cota.administradora,
        valorCarta: cota.valorCarta,
        desagioAquisicao: cota.desagioAquisicao,
        desagioRevenda: cota.desagioRevenda,
        localizacaoAprox: cota.localizacaoAprox,
        prazoRestanteMeses: cota.prazoRestanteMeses,
        caminhoPrevisto: cota.caminhoPrevisto,
        tokensEmitidos: quantityStr,
        emissaoTxHash,
        notas: cota.notas,
      },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'COTA_INCORPORADA',
        operador: 'seed-script',
        cotaId: c.id,
        stellarTxHash: emissaoTxHash,
        payloadJson: { slug: cota.slug, quantity: quantityStr, navBrl: quantity, adotadaDoLedger: adotada },
      },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'TOKEN_EMITIDO',
        operador: 'seed-script',
        cotaId: c.id,
        stellarTxHash: emissaoTxHash,
        payloadJson: { quantity: quantityStr, destination: distributorPubkey, adotadaDoLedger: adotada },
      },
    });
    // Mesma chave e mesmo valor do backfill (`backfillMovimentosFundo`): rodar o backfill depois é no-op.
    await registrarMovimentoFundo(tx, {
      tipo: 'APORTE_COTA',
      valorBrl: navDaCotaAsDecimal(cota),
      tokens: quantityStr,
      chave: `aporte-cota:${c.id}`,
      cotaId: c.id,
      refHash: emissaoTxHash,
    });
    return c;
  });

  console.log(`     ✓ ${cota.slug} criada (id=${created.id})`);
}

async function main() {
  console.log('━━━ Seed Plina POC ━━━\n');

  console.log('[1/2] ParametrosPool');
  await ensureParametrosPool();

  console.log('\n[2/2] Cotas representativas (3)');
  for (const cota of COTAS) {
    await seedCota(cota);
  }

  console.log('\n✓ Seed concluído.');
}

main()
  .catch((err) => {
    console.error('\n✗ Seed falhou:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
