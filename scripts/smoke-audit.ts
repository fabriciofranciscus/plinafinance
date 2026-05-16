/**
 * Smoke test — on-chain audit hash (whitepaper §6.1).
 *
 * Submete uma tx de auditoria com Memo.hash + payload de exemplo (cessão
 * fictícia). Confirma:
 *   - SHA-256 estável (mesma payload → mesmo hash)
 *   - tx submetida com sucesso na testnet
 *   - Memo.Hash da tx == SHA-256 do payload
 *
 * Rodar: npm run smoke:audit
 */

import { config as loadEnv } from 'dotenv';
import {
  buildAuditPayload,
  registerOnChainHash,
  sha256OfPayload,
  stableSerialize,
} from '../lib/stellar/audit';
import { txExplorerUrl } from '../lib/stellar/config';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });

async function main() {
  console.log('Smoke audit on-chain — testnet');

  // 1. Determinismo
  console.log('\n[1/3] Hash determinismo');
  const p = buildAuditPayload('cessao', 'cota_test_001', {
    valorCarta: '180000.00',
    administradora: 'Caixa Consórcios Demo',
    desagioAquisicao: '0.17',
    vendedorCpfHash: 'abc123',
  });
  const h1 = sha256OfPayload(p);
  const h2 = sha256OfPayload({ ...p });
  if (h1 !== h2) throw new Error('hash não-determinístico!');
  console.log(`     ✓ sha256 = ${h1}`);
  console.log(`     serialization = ${stableSerialize(p).slice(0, 100)}…`);

  // 2. On-chain submit
  console.log('\n[2/3] Submit tx com Memo.hash');
  const result = await registerOnChainHash(p);
  console.log(`     ✓ tx hash = ${result.txHash}`);
  console.log(`     ✓ payload hash = ${result.payloadHash}`);
  console.log(`     ✓ ${txExplorerUrl(result.txHash)}`);

  // 3. Cross-check: hash bate?
  console.log('\n[3/3] Cross-check');
  if (result.payloadHash !== h1) {
    throw new Error(
      `Hash mismatch: payload=${h1}, returned=${result.payloadHash}`,
    );
  }
  console.log('     ✓ payloadHash retornado bate com SHA-256 local');

  console.log('\n✓ Smoke audit verde.');
  console.log(
    `\nVerifica no Stellar Expert: a aba "Memo" da tx deve mostrar tipo "hash" e valor:\n     ${h1}`,
  );
}

main().catch((err) => {
  console.error('\n✗ Smoke audit FALHOU:');
  console.error(err);
  process.exit(1);
});
