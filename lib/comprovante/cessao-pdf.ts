/**
 * PDF do contrato de cessão enviado para assinatura no DocuSign (DS2).
 *
 * `pdfkit`, fontes padrão. O espaço de assinatura fica no rodapé da página 1
 * (a tab do envelope é posicionada em y=700pt, ver `posicaoAssinatura`).
 * Contém o nome do cedente (é o contrato): vai só ao DocuSign e ao armazenamento
 * privado; nunca a log, memo ou chain.
 */

import PDFDocument from 'pdfkit';

export interface CessaoPdfData {
  cessaoId: string;
  cedenteNome: string;
  administradora: string;
  tipoBem: string;
  valorCarta: string; // BRL formatado
  valorLiquido: string; // BRL formatado
  desagioPct: string;
  emitidoEm?: Date;
}

export function buildCessaoPdf(data: CessaoPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const emitido = (data.emitidoEm ?? new Date()).toLocaleDateString('pt-BR');
    doc.fontSize(10).fillColor('#057A99').text('PLINA FINANCE · CESSÃO DE COTA DE CONSÓRCIO', { characterSpacing: 1 });
    doc.moveDown(0.5);
    doc.fontSize(20).fillColor('#132728').text('Instrumento particular de cessão');
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor('#666').text(`Cessão ${data.cessaoId} · emitido em ${emitido}`);
    doc.moveDown(1);

    const row = (label: string, value: string) => {
      doc.fontSize(9).fillColor('#888').text(label.toUpperCase(), { characterSpacing: 1 });
      doc.fontSize(12).fillColor('#132728').text(value);
      doc.moveDown(0.5);
    };
    row('Cedente', data.cedenteNome);
    row('Cessionária', 'Plina Finance');
    row('Administradora do grupo', data.administradora);
    row('Tipo de bem', data.tipoBem);
    row('Valor da carta de crédito', data.valorCarta);
    row('Deságio aplicado', data.desagioPct);
    row('Valor líquido a pagar ao cedente', data.valorLiquido);

    doc.moveDown(0.5);
    doc
      .fontSize(9)
      .fillColor('#444')
      .text(
        'O cedente transfere à cessionária os direitos e obrigações da cota acima, pelo valor líquido indicado, ' +
          'sujeito à prévia anuência da administradora (Lei 11.795/2008, art. 13). O pagamento ocorre após a assinatura ' +
          'e o registro do documento; o hash SHA-256 do PDF assinado é ancorado na Stellar como prova de integridade.',
        { lineGap: 2 },
      );

    // Rodapé de assinatura (a tab do DocuSign cai em y=700pt).
    doc.fontSize(9).fillColor('#888').text('ASSINATURA DO CEDENTE', 72, 660, { characterSpacing: 1 });
    doc.moveTo(72, 720).lineTo(300, 720).strokeColor('#999').stroke();
    doc.end();
  });
}
