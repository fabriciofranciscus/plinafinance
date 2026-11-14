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
  /** Rede ≠ PUBLIC: o documento é uma demonstração e NÃO pode se apresentar como contrato real (Consuelo A1). */
  demonstracao: boolean;
  /** SHA-256 do laudo de validação legal da cessão (último COTA_VALIDADA); `null` se ainda não registrado. */
  hashLaudo: string | null;
}

/** Frase da Norma (microcopy §3): a forma de pagamento ao cedente. */
export const FRASE_PIX =
  'O pagamento é feito por Pix para a chave CPF (ou CNPJ) do titular. Cadastre-a no seu banco antes de assinar.';

export const FAIXA_DEMONSTRACAO =
  'DEMONSTRAÇÃO · REDE DE TESTES · DADOS FICTÍCIOS · SEM EFEITO JURÍDICO NEM FINANCEIRO';

/**
 * Textos variáveis do instrumento (Consuelo, parecer D10: A1–A4), separados do desenho do PDF para serem testáveis.
 * Demonstração = rede ≠ PUBLIC. A cláusula real de pagamento depende das decisões D1–D4 da minuta (Thais): fora da
 * demonstração o parágrafo de pagamento fica o genérico de antes.
 */
export function textosCessao(d: Pick<CessaoPdfData, 'demonstracao' | 'hashLaudo'>) {
  const laudo = d.hashLaudo
    ? d.demonstracao
      ? `conforme o documento de teste, não emitido por administradora (laudo ${d.hashLaudo})`
      : `conforme o item 7 do laudo ${d.hashLaudo}`
    : 'conforme o laudo de validação legal (ainda não registrado na emissão deste documento)';
  return {
    faixa: d.demonstracao ? FAIXA_DEMONSTRACAO : null,
    situacao:
      (d.demonstracao
        ? 'Situação da cota: quitada no modelo (saldo devedor zero), R$ 0,00 (Res. BCB 285, art. 26), '
        : 'Situação da cota: quitada. Saldo devedor R$ 0,00 (Res. BCB 285, art. 26), ') +
      `${laudo}. Nenhuma prestação ou obrigação financeira pendente é transferida.`,
    pagamento: d.demonstracao
      ? 'O preço líquido é pago por Pix (simulado em rede de testes) para a chave CPF (ou CNPJ) do titular, após a assinatura. ' +
        `${FRASE_PIX} A anuência da administradora é simulada nesta demonstração.`
      : `O pagamento ocorre após a assinatura e o registro do documento. ${FRASE_PIX}`,
    ancora: d.demonstracao
      ? 'O hash SHA-256 do PDF assinado é ancorado na Stellar testnet como prova de integridade.'
      : 'O hash SHA-256 do PDF assinado é ancorado na Stellar como prova de integridade.',
  };
}

export function buildCessaoPdf(data: CessaoPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const emitido = (data.emitidoEm ?? new Date()).toLocaleDateString('pt-BR');
    const t = textosCessao(data);
    if (t.faixa) {
      doc.fontSize(9).fillColor('#B42318').text(t.faixa, { align: 'center', characterSpacing: 0.5 });
      doc.moveDown(0.6);
    }
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
    doc.fontSize(9).fillColor('#444').text(t.situacao, { lineGap: 2 });
    doc.moveDown(0.5);
    doc
      .fontSize(9)
      .fillColor('#444')
      .text(
        'O cedente transfere à cessionária os direitos e obrigações da cota acima, pelo valor líquido indicado, ' +
          'sujeito à prévia anuência da administradora (Lei 11.795/2008, art. 13). ' +
          `${t.pagamento} ${t.ancora}`,
        { lineGap: 2 },
      );

    // Rodapé de assinatura (a tab do DocuSign cai em y=700pt).
    doc.fontSize(9).fillColor('#888').text('ASSINATURA DO CEDENTE', 72, 660, { characterSpacing: 1 });
    doc.moveTo(72, 720).lineTo(300, 720).strokeColor('#999').stroke();
    if (t.faixa) {
      // Rodapé (dentro da margem inferior, para não abrir uma 2ª página).
      doc.fontSize(8).fillColor('#B42318').text(t.faixa, 56, 756, { align: 'center', width: 483, lineBreak: false });
    }
    doc.end();
  });
}
