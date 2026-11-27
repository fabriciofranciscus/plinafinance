// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { FaixaContexto } from '../_components/shell/faixa-contexto';
import { CessaoScreen } from '../_components/screens/cessao';
import { KycScreen } from '../_components/screens/kyc';
import { ConfirmacaoScreen } from '../_components/screens/confirmacao';
import { PropostaScreen } from '../_components/screens/proposta';
import { DiligenciaScreen } from '../_components/screens/diligencia';
import { screenLabel } from '../_lib/glossary';
import { Rail } from '../_components/shell/rail';
import type { CessaoData, CotaResumo, ReservaData } from '../_types';

// AP-5 /comprar, PR 1 (Íris, comprar-composicao/SPEC.md C1, C2, C6, C7, C11): contexto persistente, só composição.
const cota: CotaResumo = { id: 'c1', tipoBem: 'IMOVEL', valorCarta: 200000, desagioRevenda: 0.25, localizacaoAprox: 'Campinas, SP', prazoRestanteMeses: 0, statusEstoque: 'DISPONIVEL' };
const reserva: ReservaData = { reservaId: 'res-1234567890abcdef', expiraEm: '2026-11-20T15:30:00.000Z', txHash: 'aaaaaaaabbbbbbbbcccccccc' } as ReservaData;
const cessao = { cessaoCompradorId: 'ces-1234567890abcdef', hashDocumento: 'ddddddddddeeeeeeee', txHash: 'ffffffffgggggggg' } as CessaoData;
const pessoa = { nome: 'Comprador Teste', email: 'c@exemplo.test' } as never;
const formatada = new Date(reserva.expiraEm).toLocaleString('pt-BR', { hour12: false });
const faixa = () => screen.getByTestId('faixa-contexto');
const antes = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

afterEach(cleanup);

describe('faixa de contexto (C1, C2)', () => {
  it('é um <dl> com os rótulos já existentes: Cota, Valor de face, Valor a pagar, Validade da reserva', () => {
    render(<FaixaContexto cota={cota} reserva={reserva} />);
    const f = faixa();
    expect(f.tagName).toBe('DL');
    expect([...f.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Cota', 'Valor de face', 'Valor a pagar', 'Validade da reserva']);
    const dd = [...f.querySelectorAll('dd')].map((d) => d.textContent?.replace(/\s/g, ' '));
    expect(dd[0]).toBe('Imóvel · Campinas, SP');
    expect(dd[1]).toMatch(/^R\$\s200\.000$/);
    expect(dd[2]).toMatch(/^R\$\s150\.000$/); // 200000 × (1 − 0,25), o mesmo valorRevenda de hoje
    expect(dd[3]).toBe(formatada); // a data é exatamente expiraEm, sem cálculo nem contagem regressiva
  });

  it('sem reserva a linha de validade não existe (nem placeholder)', () => {
    render(<FaixaContexto cota={cota} reserva={null} />);
    expect([...faixa().querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Cota', 'Valor de face', 'Valor a pagar']);
  });

  it('modo só-Cota (Proposta) e modo sem "Valor a pagar" (confirmação pendente)', () => {
    const { unmount } = render(<FaixaContexto cota={cota} reserva={null} soCota />);
    expect([...faixa().querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Cota']);
    unmount();
    render(<FaixaContexto cota={cota} reserva={reserva} semValorAPagar />);
    expect([...faixa().querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Cota', 'Valor de face', 'Validade da reserva']);
  });

  it('sem cota não renderiza nada', () => {
    const { container } = render(<FaixaContexto cota={null} reserva={reserva} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('a faixa aparece nas telas certas, abaixo do parágrafo e sem mudar de lugar', () => {
  it('diligência: faixa sem validade (ainda não há reserva)', () => {
    render(<DiligenciaScreen selectedCota={cota} data={null} loading={false} onContinue={() => {}} />);
    expect(faixa()).toBeTruthy();
    expect(within(faixa()).queryByText('Validade da reserva')).toBeNull();
    expect(antes(screen.getByRole('heading', { level: 1 }), faixa())).toBe(true);
  });

  it('proposta: só "Cota" na faixa; a tabela com "72 horas" continua como conteúdo', () => {
    render(<PropostaScreen cota={cota} loading={false} onAceitar={() => {}} />);
    expect([...faixa().querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Cota']);
    expect(screen.getByText('72 horas')).toBeTruthy();
  });

  it('identidade (KYC): cota, valores e a validade real da reserva', () => {
    render(<KycScreen pessoa={pessoa} cota={cota} reserva={reserva} loading={false} onSubmit={() => {}} />);
    expect(within(faixa()).getByText(formatada)).toBeTruthy();
    expect(antes(faixa(), screen.getByLabelText('Nome completo'))).toBe(true);
  });

  it('cessão: faixa com validade antes do Documento; Cota e Valor a pagar saem do bloco Documento', () => {
    render(<CessaoScreen pessoa={pessoa} cota={cota} reserva={reserva} cessao={null} signing={false} onAssinar={() => {}} />);
    expect(within(faixa()).getByText(formatada)).toBeTruthy();
    const doc = screen.getByTestId('documento-cessao');
    expect(within(doc).queryByText('Valor a pagar')).toBeNull();
    expect(within(doc).queryByText('Cota')).toBeNull();
    expect(antes(faixa(), doc)).toBe(true);
  });

  it('confirmação inicial: faixa completa; pendente: sem "Valor a pagar" (a frase é a única fonte); realizada: sem faixa', () => {
    const { unmount } = render(<ConfirmacaoScreen cota={cota} reserva={reserva} cessao={cessao} confirmacao={null} confirming={false} onConfirmar={() => {}} />);
    expect([...faixa().querySelectorAll('dt')]).toHaveLength(4);
    unmount();
    const pend = { status: 'PENDENTE_CONFIRMACAO', valorRealizado: '150000' } as never;
    const p = render(<ConfirmacaoScreen cota={cota} reserva={reserva} cessao={cessao} confirmacao={pend} confirming={false} onConfirmar={() => {}} />);
    expect([...faixa().querySelectorAll('dt')].map((d) => d.textContent)).not.toContain('Valor a pagar');
    expect(screen.getByText(/Valor a pagar: R\$\s150\.000/)).toBeTruthy();
    p.unmount();
    const ok = { status: 'REALIZADA', valorRealizado: '150000', txHash: 'hhhhhhhhhh' } as never;
    render(<ConfirmacaoScreen cota={cota} reserva={reserva} cessao={cessao} confirmacao={ok} confirming={false} onConfirmar={() => {}} />);
    expect(screen.queryByTestId('faixa-contexto')).toBeNull();
  });
});

describe('cessão sem aparência de campo (C6)', () => {
  it('Nome e E-mail em pares rótulo/valor (<dl>), sem caixas com borda; o título do documento não repete o h1', () => {
    render(<CessaoScreen pessoa={pessoa} cota={cota} reserva={reserva} cessao={null} signing={false} onAssinar={() => {}} />);
    const doc = screen.getByTestId('documento-cessao');
    const dl = doc.querySelector('dl') as HTMLElement;
    expect([...dl.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Nome', 'E-mail']);
    expect([...dl.querySelectorAll('dd')].map((d) => d.textContent)).toEqual(['Comprador Teste', 'c@exemplo.test']);
    expect([...dl.querySelectorAll('dd')].every((d) => !/\bborder\b/.test(d.className))).toBe(true);
    const h1 = screen.getByRole('heading', { level: 1 }).textContent;
    expect(within(doc).queryByText(h1!.replace(/\.$/, ''))).toBeNull();
  });

  it('a linha da reserva mantém o mesmo texto', () => {
    render(<CessaoScreen pessoa={pessoa} cota={cota} reserva={reserva} cessao={null} signing={false} onAssinar={() => {}} />);
    // o tx agora é link (C5), então o texto é conferido pelo parágrafo inteiro
    expect(screen.getByTestId('documento-cessao').textContent).toContain('Reserva res-12345678… · prova on-chain aaaaaaaa…');
  });
});

describe('nota de upload estática (C7)', () => {
  it('a mesma frase, sem caixa tracejada, e a seta é decorativa', () => {
    const { container } = render(<KycScreen pessoa={pessoa} cota={cota} reserva={reserva} loading={false} onSubmit={() => {}} />);
    expect(container.querySelector('.border-dashed')).toBeNull();
    const nota = screen.getByTestId('nota-upload');
    expect(nota.textContent).toBe('⬆ Upload de documento + selfie · auto-aprovado no ambiente de testes');
    expect(nota.querySelector('[aria-hidden="true"]')?.textContent).toBe('⬆');
  });
});

describe('celular: fase + subtela (C11)', () => {
  it('screenLabel devolve o rótulo existente de SCREENS', () => {
    expect(screenLabel('kyc')).toBe('KYC');
    expect(screenLabel('cessao')).toBe('Assinatura');
  });
  it('o trilho de desktop segue mostrando as subtelas (sem regressão)', () => {
    render(<Rail current="kyc" />);
    expect(screen.getByText('KYC')).toBeTruthy();
    expect(screen.getByText('Assinatura')).toBeTruthy();
  });
});

describe('confirmação antes do envio: não promete aquisição concluída', () => {
  it('parágrafo aprovado pela Norma', () => {
    render(<ConfirmacaoScreen cota={cota} reserva={reserva} cessao={cessao} confirmacao={null} confirming={false} onConfirmar={() => {}} />);
    const texto = document.body.textContent!.replace(/\s+/g, ' ');
    expect(texto).toContain('A cessão está assinada e registrada na rede de testes. Confirme para registrar a transferência de titularidade, que depende da aprovação da administradora.');
    expect(texto).not.toContain('finalizar a aquisição');
  });
});

describe('confirmação pendente: sem promessa de e-mail; quem aprova é a administradora', () => {
  it('parágrafo aprovado pela Norma', () => {
    const pend = { status: 'PENDENTE_CONFIRMACAO', valorRealizado: '150000' } as never;
    render(<ConfirmacaoScreen cota={cota} reserva={reserva} cessao={cessao} confirmacao={pend} confirming={false} onConfirmar={() => {}} />);
    const texto = document.body.textContent!.replace(/\s+/g, ' ');
    expect(texto).toMatch(/Sua cessão está assinada e a reserva registrada\. A transferência de titularidade depende da aprovação da administradora\. Valor a pagar: R\$ 150\.000/);
    expect(texto).not.toMatch(/por e-mail|A equipe Plina confirma/);
  });
});

describe('frases protegidas N2–N5: mesmas, na mesma ordem relativa (regressão byte a byte)', () => {
  const ordem = (arquivo: string, frases: string[]) => {
    const src = readFileSync(`app/comprar/_components/screens/${arquivo}`, 'utf8');
    const idx = frases.map((f) => {
      expect(src, `${arquivo}: "${f}"`).toContain(f);
      return src.indexOf(f);
    });
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  };
  it('diligência', () =>
    ordem('diligencia.tsx', [
      'Transparência total da cota.',
      'Contemplação confirmada — laudo de validação legal arquivado.',
      'Adimplência verificada — parcelas em dia até a originação.',
      'Titularidade validada — CPF do cedente conferido na administradora.',
      'Cessão registrada — hash on-chain:',
      'Avançar para proposta →',
    ]));
  it('proposta', () =>
    ordem('proposta.tsx', [
      'Ao aceitar, a cota é reservada por 72h em seu nome enquanto você conclui',
      'v="72 horas"',
      'O desconto reflete o deságio original pago ao cotista mais a margem',
      'Li e compreendi as condições da cessão de direitos creditórios.',
    ]));
  it('identidade', () =>
    ordem('kyc.tsx', [
      'Verificação de identidade (KYC) antes da assinatura da cessão, como',
      'Autorizo o tratamento dos meus dados para verificação KYC/AML (LGPD).',
    ]));
  it('confirmação', () =>
    ordem('confirmacao.tsx', [
      'Confirme a transferência de titularidade.',
      'Aguardando confirmação.',
      'A transferência de titularidade depende da aprovação da administradora.',
      'Próximos passos',
    ]));
});
