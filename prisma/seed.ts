/**
 * Seed do POC — bootstrap da demo.
 *
 * Cria ParametrosPool (singleton) + 3 cotas representativas (imóvel, veículo,
 * equipamento) com emissão real on-chain antes de persistir no DB. Respeita
 * a key rule do CLAUDE.md: "DB só atualiza APÓS sucesso on-chain."
 *
 * Idempotente: roda múltiplas vezes sem duplicar. Skip se já tiver as cotas
 * (matched por `notas` slug). Re-rodar pra recompor estado da demo se
 * necessário (testnet sem stakes).
 *
 * Pré-requisito: STELLAR_ISSUER_SECRET + STELLAR_DISTRIBUTOR_PUBLIC no
 * .env.local (vem do smoke-stellar inicial). Distributor precisa ter
 * trustline AUTHORIZED pra PLINARF (o smoke já fez isso).
 *
 * Rodar:  npm run prisma:seed
 */

import { PrismaClient, TipoBem, CaminhoRealizacao } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { issueAsset } from '../lib/stellar/issuer';
import { KeypairSigner } from '../lib/stellar/signer';
import {
  accountExplorerUrl,
  assetCode,
  txExplorerUrl,
} from '../lib/stellar/config';
import { tokensParaEmitir } from '../lib/services/pool';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });

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
  const distributorPubkey = process.env.STELLAR_DISTRIBUTOR_PUBLIC;
  if (!issuerSecret || !distributorPubkey) {
    throw new Error(
      'STELLAR_ISSUER_SECRET + STELLAR_DISTRIBUTOR_PUBLIC obrigatórios.',
    );
  }

  const quantity = tokensParaEmitir({
    valorCarta: cota.valorCarta,
    desagioAquisicao: cota.desagioAquisicao,
  });
  const quantityStr = quantity.toFixed(7);

  // 1. Emite on-chain ANTES de persistir no DB (key rule CLAUDE.md).
  console.log(`     · emitindo ${quantityStr} ${assetCode} pra distributor...`);
  const emissionRes = await issueAsset(
    new KeypairSigner(issuerSecret),
    distributorPubkey,
    quantityStr,
  );
  console.log(`       tx: ${txExplorerUrl(emissionRes.hash)}`);

  // 2. Sucesso on-chain → persiste DB com hash + tokensEmitidos.
  const created = await prisma.cota.create({
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
      emissaoTxHash: emissionRes.hash,
      notas: cota.notas,
    },
  });

  // 3. Audit log.
  await prisma.eventoAudit.create({
    data: {
      acao: 'COTA_INCORPORADA',
      operador: 'seed-script',
      cotaId: created.id,
      stellarTxHash: emissionRes.hash,
      payloadJson: {
        slug: cota.slug,
        quantity: quantityStr,
        navBrl: quantity,
      },
    },
  });
  await prisma.eventoAudit.create({
    data: {
      acao: 'TOKEN_EMITIDO',
      operador: 'seed-script',
      cotaId: created.id,
      stellarTxHash: emissionRes.hash,
      payloadJson: { quantity: quantityStr, destination: distributorPubkey },
    },
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
