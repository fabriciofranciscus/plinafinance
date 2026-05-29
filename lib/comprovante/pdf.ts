/**
 * Geração do comprovante de cessão/Pix em PDF (PRD §M1 F-M1-8).
 *
 * `pdfkit` puro (sem browser headless). Usa as fontes padrão (Helvetica)
 * embutidas no pacote — não precisa de arquivos de fonte externos.
 */

import PDFDocument from 'pdfkit';

export interface ComprovanteData {
  cessaoId: string;
  valorLiquido: string; // BRL formatado
  desagioPct: string;
  administradora: string;
  tipoBem: string;
  hashDocumento?: string | null;
  cessaoTxHash?: string | null;
  pixTxHash?: string | null;
  emitidoEm?: Date;
}

export function buildComprovantePdf(data: ComprovanteData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const emitido = (data.emitidoEm ?? new Date()).toLocaleString('pt-BR', {
      hour12: false,
    });

    doc
      .fontSize(10)
      .fillColor('#057A99')
      .text('PLINA FINANCE · COMPROVANTE DE CESSÃO', { characterSpacing: 1 });
    doc.moveDown(0.5);
    doc.fontSize(22).fillColor('#132728').text('Cessão registrada');
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor('#666').text(`Cessão id: ${data.cessaoId}`);
    doc.fontSize(9).fillColor('#666').text(`Emitido em: ${emitido}`);
    doc.moveDown(1);

    const row = (label: string, value: string) => {
      doc.fontSize(9).fillColor('#888').text(label.toUpperCase(), { characterSpacing: 1 });
      doc.fontSize(12).fillColor('#132728').text(value);
      doc.moveDown(0.6);
    };

    row('Valor líquido cedido', data.valorLiquido);
    row('Deságio aplicado', data.desagioPct);
    row('Tipo de bem', data.tipoBem);
    row('Administradora', data.administradora);
    if (data.hashDocumento) row('SHA-256 do documento', data.hashDocumento);
    if (data.cessaoTxHash) row('Tx Stellar (cessão)', data.cessaoTxHash);
    if (data.pixTxHash) row('Tx Stellar (Pix)', data.pixTxHash);

    doc.moveDown(1);
    doc
      .fontSize(8)
      .fillColor('#888')
      .text(
        'Documento gerado automaticamente. As provas on-chain podem ser verificadas no Stellar Expert; ' +
          'o SHA-256 acima deve bater com o memo da transação de cessão.',
        { lineGap: 2 },
      );

    doc.end();
  });
}
