/**
 * Smoke — DocuSign sandbox (demo): JWT → envelope com PDF "MINUTA – TESTNET" → status.
 *
 * O primeiro token prova o consentimento (signature impersonation). O envelope vai
 * por e-mail para o endereço passado por argumento (o signatário recebe de fato).
 *
 * Rodar:  pnpm smoke:docusign signatario@exemplo.com [nome]
 * Saída:  só o envelopeId e o status. Nunca imprime token, chave nem e-mail.
 */

import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import {
  criarClienteDocusign,
  DocusignConsentRequiredError,
  DocusignError,
  transactionIdDeterministico,
} from '../lib/integrations/docusign';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });

/** PDF mínimo de 1 página (Letter) com a marca de teste e um espaço para a assinatura. */
function gerarPdfMinuta(): Buffer {
  const linhas = [
    ['/F1 22 Tf', 72, 720, 'MINUTA \x96 TESTNET'],
    ['/F1 11 Tf', 72, 690, 'Documento de teste do sandbox DocuSign. Sem valor juridico.'],
    ['/F1 11 Tf', 72, 110, 'Assinatura:'],
  ] as const;
  const conteudo = linhas.map(([f, x, y, t]) => `BT ${f} ${x} ${y} Td (${t}) Tj ET`).join('\n');
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(conteudo, 'latin1')} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objetos.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function main() {
  const email = process.argv[2];
  const nome = process.argv[3] ?? 'Signatario Testnet';
  if (!email) {
    console.error('Uso: pnpm smoke:docusign <email-do-signatario> [nome]');
    process.exit(2);
  }

  const docusign = criarClienteDocusign();

  await docusign.obterToken();
  console.log('1. token JWT obtido (consentimento OK)');

  const entrada = {
    documentoPdf: gerarPdfMinuta(),
    nomeDocumento: 'Minuta TESTNET.pdf',
    signatario: { nome, email },
    emailSubject: 'MINUTA – TESTNET (sandbox Plina)',
    transactionId: transactionIdDeterministico(`smoke-docusign:${randomUUID()}`),
  };
  const { envelopeId } = await docusign.criarEnvelope(entrada);
  console.log(`2. envelope criado: ${envelopeId}`);

  // Prova de idempotência: repetir com a mesma transactionId devolve o MESMO envelope (sem 2º e-mail).
  const repetido = await docusign.criarEnvelope(entrada);
  console.log(`2b. reenvio com a mesma transactionId: ${repetido.envelopeId === envelopeId ? 'mesmo envelope (idempotente)' : 'ENVELOPE DIFERENTE — idempotência falhou'}`);
  if (repetido.envelopeId !== envelopeId) process.exit(1);

  const status = await docusign.obterStatusEnvelope(envelopeId);
  console.log(`3. status: ${status}`);
}

main().catch((e) => {
  if (e instanceof DocusignConsentRequiredError) {
    console.error(`FALHA [${e.codigo}] ${e.message}`);
  } else if (e instanceof DocusignError) {
    console.error(`FALHA [${e.codigo}${e.httpStatus ? ` HTTP ${e.httpStatus}` : ''}] ${e.message}`);
  } else {
    console.error('FALHA inesperada no smoke DocuSign (detalhes omitidos para não vazar segredos).');
  }
  process.exit(1);
});
