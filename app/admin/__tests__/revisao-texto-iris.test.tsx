// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../actions', () => ({ incorporarCotaAction: vi.fn(), registrarValidacaoLegalAction: vi.fn() }));

import { CompradorPipeline } from '../comprador-pipeline';
import { IncorporarCotaForm } from '../incorporar-cota-form';
import { PainelRevisao } from '../revisao-acao';
import { revisaoDe } from '../vendedor-pipeline';

// PR #157, parecer da Íris (25/11) e validação da Norma: ajustes de TEXTO da Revisão do /admin. Só o que o código sustenta:
// sem status cru, sem afirmar e-mail na hora (DocuSign é stub), sem "libera o pagamento" (anuência é simulada na testnet),
// sem valor calculado na tela.
afterEach(cleanup);

const lead = {
  id: 'l1', nome: 'Cedente de teste', email: 'cedente@exemplo.test', status: 'OFERTA_ACEITA', criadoEm: '2026-11-20T00:00:00Z',
  ofertas: [{ id: 'o1', versao: 1, tipoBem: 'IMOVEL', valorCarta: '150000', valorLiquidoVendedor: '120000', desagioAquisicao: '0.2', administradora: 'Porto', status: 'ACEITA', validade: null, criadaEm: '2026-11-20T00:00:00Z', cessao: null }],
} as never;
const rev = (acao: Parameters<typeof revisaoDe>[0], redePublica = false) => revisaoDe(acao, lead, redePublica);

describe('Caminho A', () => {
  const comprador = {
    id: 'c1', nome: 'Comprador', email: 'c@exemplo.test', tipo: 'PESSOA_FISICA', intencaoBem: null, status: 'RESERVOU', criadoEm: '2026-11-20T00:00:00Z',
    reservas: [{ id: 'r1', status: 'ATIVA', expiraEm: '2026-11-28T00:00:00Z', onChainTxHash: null, cota: { id: 'cota0000abcd', tipoBem: 'VEICULO', valorCarta: '80000', desagioRevenda: '0.12', status: 'RESERVADA' } }],
  };
  it('frase em minúsculas, sem o status cru, e a ordem que a Íris pediu', () => {
    render(<CompradorPipeline leads={[comprador]} realizacaoLiberada />);
    fireEvent.click(screen.getByRole('button', { name: /Executar Caminho A/ }));
    const c = screen.getByTestId('revisao-consequencia').textContent;
    expect(c).toBe('A cota sai do pool como realizada. O valor simulado passa a compor o caixa e o NAV na rede de testes. Não há como desfazer pelo painel.');
    expect(c).not.toContain('REALIZADA');
  });
});

describe('Registrar cessão e enviar para assinatura (DocuSign é stub)', () => {
  it('não afirma que o cedente recebe o e-mail na hora; diz que envia para assinatura e que não cancela por aqui', () => {
    for (const a of ['registrar-cessao', 'enviar-cessao'] as const) {
      const c = rev(a).consequencia;
      expect(c, a).not.toMatch(/e-mail na hora|recebe o e-mail/i);
      expect(c, a).toContain('para assinatura (DocuSign). Não há como cancelar o envio por aqui.');
    }
    expect(rev('enviar-cessao').consequencia).toBe('Envia o termo de cessão ao cedente para assinatura (DocuSign). Não há como cancelar o envio por aqui.');
    expect(rev('registrar-cessao').consequencia).toBe('Registra a cessão desta proposta e envia o termo ao cedente para assinatura (DocuSign). Não há como cancelar o envio por aqui.');
  });
});

describe('Anuência (Norma: não afirmar efeito real na rede de testes)', () => {
  it('na rede de testes diz que a anuência é simulada e não substitui a aprovação real; nunca "libera o pagamento"', () => {
    const c = rev('registrar-anuencia', false).consequencia;
    expect(c).toContain('Na rede de testes, a anuência é simulada. Ela registra a etapa, mas não substitui a aprovação real da administradora.');
    expect(c).not.toMatch(/libera o pagamento/);
    expect(c).toContain('Um registro novo substitui este, mas os dois ficam no histórico.');
  });
  it('na rede principal não afirma "libera o pagamento" também (⚖ jurídico decide a frase real)', () => {
    const c = rev('registrar-anuencia', true).consequencia;
    expect(c).not.toMatch(/libera o pagamento|simulada/);
    expect(c).toContain('Registra a anuência da administradora na auditoria desta cessão.');
  });
});

describe('Pagar o cedente (única ação com dinheiro real: o atesto diz a consequência)', () => {
  it('título "Revisar antes de pagar o cedente"', () => {
    expect(rev('pagar-cedente').titulo).toBe('Revisar antes de pagar o cedente');
    expect(rev('pagar-cedente', true).titulo).toBe('Revisar antes de pagar o cedente');
  });
  it('na rede principal o atesto diz que o Pix não volta, e a consequência não cita um destino que a tela não mostra', () => {
    const r = rev('pagar-cedente', true);
    expect(r.atesto).toBe('Conferi o cedente e o valor, e entendo que o Pix enviado não volta.');
    expect(r.consequencia).toBe('Envia o Pix do valor ao cedente. Pix enviado não volta.');
    expect(r.consequencia).not.toMatch(/chave do cadastro/);
  });
  it('na rede de testes o atesto e a consequência atuais continuam', () => {
    const r = rev('pagar-cedente', false);
    expect(r.atesto).toBe('Conferi o cedente e o valor do pagamento.');
    expect(r.consequencia).toBe('Envia o Pix simulado do valor ao cedente, na rede de testes. Na rede principal, esta ação envia um Pix real.');
    expect(r.confirmar).toBe('Pagar cedente (Pix simulado)');
  });
});

describe('Incorporar (Norma): só sai de circulação com uma queima registrada na rede', () => {
  it('no funil do vendedor', () => {
    const c = rev('incorporar-cota').consequencia;
    expect(c).toContain('emite PLINA-RF na Stellar (rede de testes), ao NAV do momento.');
    expect(c).toContain('Token emitido só sai de circulação com uma queima registrada na rede.');
    expect(c).not.toContain('não volta sem');
  });
  it('na incorporação avulsa, com o aporte vindo da função única', () => {
    render(<IncorporarCotaForm />);
    fireEvent.change(screen.getByLabelText('Administradora', { selector: 'input' }), { target: { value: 'Porto Seguro' } });
    fireEvent.change(screen.getByLabelText('Localização aproximada', { selector: 'input' }), { target: { value: 'São Paulo - SP' } });
    fireEvent.change(screen.getByLabelText('Valor da carta (BRL)', { selector: 'input' }), { target: { value: '250000' } });
    fireEvent.change(screen.getByLabelText('Deságio aquisição (0–1)', { selector: 'input' }), { target: { value: '0.18' } });
    fireEvent.click(screen.getByRole('button', { name: 'Incorporar cota + emitir PLINA-RF' }));
    const painel = screen.getByTestId('revisao-acao');
    expect(within(painel).getByTestId('revisao-consequencia').textContent).toContain('Token emitido só sai de circulação com uma queima registrada na rede.');
    // O aporte volta pela função pura do Bento (BigInt, meio-par), igual ao servidor; nunca em ponto flutuante na tela.
    expect(painel.textContent).toMatch(/Valor do aporte \(NAV da cota\)\s*R\$\s*205\.000,00/);
    expect(painel.textContent).toMatch(/Valor da carta\s*R\$\s*250\.000,00/);
    expect(painel.textContent).toMatch(/Deságio de aquisição\s*18,00%/);
  });
});

describe('validação legal: a cota aparece com o rótulo, não com o código do banco', () => {
  it('page.tsx monta a descrição com rotuloTipoBem e não com c.tipoBem cru', () => {
    const page = readFileSync('app/admin/page.tsx', 'utf8');
    expect(page).toMatch(/descricaoCota=\{`\$\{rotuloTipoBem\(c\.tipoBem\)\} · /);
    expect(page).not.toMatch(/descricaoCota=\{`\$\{c\.tipoBem\}/);
  });
});

describe('o atesto liga E desliga a confirmação (padrão da Vera, dinheiro)', () => {
  it('marcar habilita, desmarcar desabilita, e o clique no botão desabilitado não confirma', () => {
    const onConfirmar = vi.fn();
    render(<PainelRevisao conteudo={{ titulo: 'Revisar antes de pagar o cedente', linhas: [], consequencia: 'x', atesto: 'Conferi.', confirmar: 'Pagar cedente' }} onConfirmar={onConfirmar} onVoltar={() => {}} />);
    const caixa = screen.getByRole('checkbox') as HTMLInputElement;
    const botao = () => screen.getByRole('button', { name: 'Pagar cedente' }) as HTMLButtonElement;
    expect([caixa.checked, botao().disabled]).toEqual([false, true]);
    fireEvent.click(caixa);
    expect([caixa.checked, botao().disabled]).toEqual([true, false]);
    fireEvent.click(caixa);
    expect([caixa.checked, botao().disabled]).toEqual([false, true]);
    fireEvent.click(botao());
    expect(onConfirmar).not.toHaveBeenCalled();
    fireEvent.click(caixa);
    fireEvent.click(botao());
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });
});
