/**
 * Empacota o output do smoke test Stellar (`smoke-stellar-output.json`) num
 * relatório pronto para colar nos campos do Instawards (Entregável 1 —
 * "PLINA-RF Token Issuance & Compliance Configuration on Stellar Testnet").
 *
 * Não chama a rede Stellar — só lê e formata o JSON já gerado por
 * `npm run smoke:stellar`. Valida que os tx hashes têm 64 caracteres hex
 * (formato Stellar) antes de publicar qualquer coisa.
 *
 * Rodar:  npm run evidencia:plina-rf
 * Saída:  exports/evidencia-plina-rf.md + exports/evidencia-plina-rf.json
 *         (gitignored — contém endereços públicos e hashes, não secrets;
 *         mas a fonte `smoke-stellar-output.json` tem secret keys, então o
 *         JSON de evidência aqui SÓ inclui campos públicos, nunca `secret`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const GITHUB_REPO_URL = 'https://github.com/ThaisFReis/Plina';
const POLITICA_CLAWBACK_URL = 'https://plina.finance/politica-clawback';
const SOURCE_FILE = 'smoke-stellar-output.json';
const OUT_DIR = 'exports';

interface SmokeOutput {
  network: string;
  asset: string;
  issuer: { publicKey: string };
  distributor: { publicKey: string };
  investor: { publicKey: string };
  txs: Record<string, string>;
  explorers: Record<string, string>;
}

function isValidTxHash(hash: string): boolean {
  return /^[0-9a-f]{64}$/i.test(hash);
}

function txExplorerUrl(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

function main() {
  if (!existsSync(SOURCE_FILE)) {
    throw new Error(
      `${SOURCE_FILE} não encontrado. Rode "npm run smoke:stellar" primeiro.`,
    );
  }

  const raw = readFileSync(SOURCE_FILE, 'utf-8');
  const data = JSON.parse(raw) as SmokeOutput;

  if (data.network !== 'TESTNET') {
    throw new Error(`Esperava network TESTNET, encontrou ${data.network}.`);
  }

  const malformados = Object.entries(data.txs).filter(
    ([, hash]) => !isValidTxHash(hash),
  );
  if (malformados.length > 0) {
    const lista = malformados
      .map(([nome, hash]) => `  - ${nome}: "${hash}" (${hash.length} chars)`)
      .join('\n');
    throw new Error(
      `Tx hash(es) malformado(s) (esperado 64 chars hex):\n${lista}\n` +
        `Rode "npm run smoke:stellar" de novo para gerar um run válido.`,
    );
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const issuerExplorerUrl =
    data.explorers.issuer ??
    `https://stellar.expert/explorer/testnet/account/${data.issuer.publicKey}`;

  const evidenciaJson = {
    geradoEm: new Date().toISOString(),
    network: data.network,
    asset: data.asset,
    contas: {
      issuer: { publicKey: data.issuer.publicKey, explorer: issuerExplorerUrl },
      distributor: {
        publicKey: data.distributor.publicKey,
        explorer: data.explorers.distributor,
      },
      investor: {
        publicKey: data.investor.publicKey,
        explorer: data.explorers.investor,
      },
    },
    transacoes: Object.fromEntries(
      Object.entries(data.txs).map(([nome, hash]) => [
        nome,
        { hash, explorer: txExplorerUrl(hash) },
      ]),
    ),
    links: {
      repositorioGithub: GITHUB_REPO_URL,
      politicaClawback: POLITICA_CLAWBACK_URL,
    },
  };
  writeFileSync(
    `${OUT_DIR}/evidencia-plina-rf.json`,
    JSON.stringify(evidenciaJson, null, 2),
  );

  const md = `# Evidência — PLINA-RF Token Issuance & Compliance (Stellar Testnet)

Gerado em ${evidenciaJson.geradoEm} a partir de um run real de
\`npm run smoke:stellar\` na testnet. Pronto para colar nos campos do
Instawards (Entregável 1).

## Link do Repositório GitHub
${GITHUB_REPO_URL}

## Stellar Expert - Conta Issuer
${issuerExplorerUrl}

## Hash Transação Clawback
\`${data.txs.clawback}\`
Explorer: ${txExplorerUrl(data.txs.clawback)}

## Documento Política Clawback
${POLITICA_CLAWBACK_URL}

## Screenshot Flags Compliance
**Ação manual necessária** (não automatizável): abra o link da conta issuer
acima no Stellar Expert, role até a seção "Flags" e tire um screenshot
mostrando \`AUTH_REQUIRED\`, \`AUTH_REVOCABLE\` e \`AUTH_CLAWBACK_ENABLED\`
habilitadas.

---

## Demais transações do fluxo (referência)

| Etapa | Tx hash | Explorer |
|---|---|---|
${Object.entries(data.txs)
  .map(([nome, hash]) => `| ${nome} | \`${hash}\` | ${txExplorerUrl(hash)} |`)
  .join('\n')}

## Contas envolvidas

| Papel | Endereço | Explorer |
|---|---|---|
| Issuer | \`${data.issuer.publicKey}\` | ${issuerExplorerUrl} |
| Distributor | \`${data.distributor.publicKey}\` | ${data.explorers.distributor} |
| Investidor (demo) | \`${data.investor.publicKey}\` | ${data.explorers.investor} |

⚠️ Antes de publicar: confirme que o issuer acima bate com
\`ParametrosPool.issuerPubkey\` no banco (usado por \`/.well-known/stellar.toml\`)
para não publicar dois issuers "oficiais" conflitantes.
`;
  writeFileSync(`${OUT_DIR}/evidencia-plina-rf.md`, md);

  console.log(`✓ Evidência gerada em ${OUT_DIR}/evidencia-plina-rf.md`);
  console.log(`✓ Dados estruturados em ${OUT_DIR}/evidencia-plina-rf.json`);
}

main();
