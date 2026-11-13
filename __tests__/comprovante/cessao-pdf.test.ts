import { describe, expect, it } from 'vitest';
import { FAIXA_DEMONSTRACAO, FRASE_PIX, buildCessaoPdf, textosCessao } from '@/lib/comprovante/cessao-pdf';

const HASH = 'c'.repeat(64);

describe('textosCessao (Consuelo D10: A1–A4)', () => {
  it('A1: rede ≠ PUBLIC → faixa de demonstração; PUBLIC → sem faixa', () => {
    expect(textosCessao({ demonstracao: true, hashLaudo: HASH }).faixa).toBe(FAIXA_DEMONSTRACAO);
    expect(FAIXA_DEMONSTRACAO).toBe('DEMONSTRAÇÃO · REDE DE TESTES · DADOS FICTÍCIOS · SEM EFEITO JURÍDICO NEM FINANCEIRO');
    expect(textosCessao({ demonstracao: false, hashLaudo: HASH }).faixa).toBeNull();
  });

  it('A2: diz que a cota é quitada, com saldo devedor zero e o hash do laudo', () => {
    const real = textosCessao({ demonstracao: false, hashLaudo: HASH }).situacao;
    expect(real).toContain('Situação da cota: quitada. Saldo devedor R$ 0,00 (Res. BCB 285, art. 26)');
    expect(real).toContain(`conforme o item 7 do laudo ${HASH}`);
    expect(real).toContain('Nenhuma prestação ou obrigação financeira pendente é transferida.');
    const demo = textosCessao({ demonstracao: true, hashLaudo: HASH }).situacao;
    expect(demo).toContain('quitada no modelo (saldo devedor zero)');
    expect(demo).toContain('conforme o documento de teste, não emitido por administradora');
    expect(demo).toContain(HASH);
  });

  it('A2: sem laudo registrado não inventa hash nem cita "item 7"', () => {
    const t = textosCessao({ demonstracao: true, hashLaudo: null }).situacao;
    expect(t).toContain('ainda não registrado');
    expect(t).not.toMatch(/item 7|[0-9a-f]{64}/);
  });

  it('A3: na demonstração descreve o fluxo real (Pix simulado para a chave CPF, anuência simulada)', () => {
    const t = textosCessao({ demonstracao: true, hashLaudo: HASH }).pagamento;
    expect(t).toContain('Pix (simulado em rede de testes) para a chave CPF (ou CNPJ) do titular, após a assinatura');
    expect(t).toContain(FRASE_PIX);
    expect(FRASE_PIX).toBe('O pagamento é feito por Pix para a chave CPF (ou CNPJ) do titular. Cadastre-a no seu banco antes de assinar.');
    expect(t).toContain('anuência da administradora é simulada nesta demonstração');
    const real = textosCessao({ demonstracao: false, hashLaudo: HASH }).pagamento;
    expect(real).not.toMatch(/simulad/i);
    expect(real).toContain(FRASE_PIX);
  });

  it('A4: "Stellar testnet" só na demonstração', () => {
    expect(textosCessao({ demonstracao: true, hashLaudo: HASH }).ancora).toContain('Stellar testnet');
    expect(textosCessao({ demonstracao: false, hashLaudo: HASH }).ancora).not.toContain('testnet');
  });
});

describe('buildCessaoPdf', () => {
  const base = {
    cessaoId: 'ces_1', cedenteNome: 'Fulano de Teste', administradora: 'Adm X', tipoBem: 'VEICULO',
    valorCarta: 'R$ 50.000,00', valorLiquido: 'R$ 30.000,00', desagioPct: '40.00%', hashLaudo: HASH,
  };

  it('gera um PDF válido de UMA página (o rodapé da demonstração não abre página extra), demonstração ou não', async () => {
    for (const demonstracao of [true, false]) {
      const pdf = await buildCessaoPdf({ ...base, demonstracao });
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
    }
  });
});
