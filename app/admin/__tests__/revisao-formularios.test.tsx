// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const { incorporar, validar } = vi.hoisted(() => ({
  incorporar: vi.fn(async () => ({ ok: true, txHash: 'f'.repeat(64) })),
  validar: vi.fn(async () => ({ ok: true, txHash: 'e'.repeat(64) })),
}));
vi.mock('../actions', () => ({ incorporarCotaAction: incorporar, registrarValidacaoLegalAction: validar }));

import { CompradorPipeline } from '../comprador-pipeline';
import { IncorporarCotaForm } from '../incorporar-cota-form';
import { ValidacaoForm } from '../validacao-form';

/**
 * Ações irreversíveis de formulário (Caminho A, incorporação avulsa, validação legal) e o cancelar reserva: enviar
 * abre a Revisão; só a confirmação, com o atesto, executa. Dados alterados depois de revisados voltam para a Revisão.
 */

const revisao = () => within(screen.getByTestId('revisao-acao'));
const confirmar = () => {
  fireEvent.click(revisao().getByRole('checkbox'));
  fireEvent.click(revisao().getAllByRole('button')[0]!);
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  refresh.mockClear();
  incorporar.mockClear();
  validar.mockClear();
  fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const comprador = {
  id: 'l1',
  nome: 'Comprador de teste',
  email: 'comprador@exemplo.test',
  tipo: 'PESSOA_FISICA',
  intencaoBem: null,
  status: 'RESERVOU',
  criadoEm: '2026-11-20T00:00:00Z',
  reservas: [
    {
      id: 'r1',
      status: 'ATIVA',
      expiraEm: '2026-11-28T00:00:00Z',
      onChainTxHash: null,
      cota: { id: 'cota0000abcd', tipoBem: 'VEICULO', valorCarta: '80000', desagioRevenda: '0.12', status: 'RESERVADA' },
    },
  ],
};
const corpo = () => JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));

describe('Caminho A', () => {
  it('Executar abre a Revisão com comprador, cota e valor; só a confirmação envia', async () => {
    render(<CompradorPipeline leads={[comprador]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Executar Caminho A' }));
    expect(fetchMock).not.toHaveBeenCalled();
    const texto = screen.getByTestId('revisao-acao').textContent!;
    expect(texto).toContain('Comprador de teste · comprador@exemplo.test');
    expect(texto).toContain('Veículo');
    expect(texto).toMatch(/Valor simulado\s*R\$\s*70\.400,00/);
    confirmar();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(corpo()).toEqual({ action: 'executar-caminho-a', reservaId: 'r1', valorRealizado: '70400' });
  });

  // Consuelo (condição no #157) + decisão do Atlas: sem gate no servidor, o atesto precisa dizer o que o operador afirma.
  // Na rede de testes o pagamento é simulado e nada o registra (Vera): nem "comprovado" nem "registrado"; "comprovado" só na principal.
  it.each([
    [false, 'Conferi o comprador, a cota e o valor, e entendo que o pagamento do comprador é simulado na rede de testes.', 'A cota sai do pool como realizada. O valor simulado passa a compor o caixa e o NAV na rede de testes. Não há como desfazer pelo painel.'],
    [true, 'Conferi o comprador, a cota e o valor efetivamente recebido, e o pagamento do comprador está comprovado.', 'A cota sai do pool como realizada. O valor recebido entra no caixa do fundo e passa a compor o NAV. Não há como desfazer pelo painel.'],
  ])('rede principal=%s: atesto e consequência próprios; é o atesto que habilita a execução', (redePublica, texto, consequencia) => {
    render(<CompradorPipeline leads={[comprador]} redePublica={redePublica} />);
    fireEvent.click(screen.getByRole('button', { name: 'Executar Caminho A' }));
    expect(screen.getByTestId('revisao-consequencia').textContent).toBe(consequencia);
    const atesto = revisao().getByRole('checkbox', { name: texto });
    const executar = revisao().getByRole('button', { name: 'Executar Caminho A' }) as HTMLButtonElement;
    expect(executar.disabled).toBe(true);
    fireEvent.click(atesto);
    expect(executar.disabled).toBe(false);
    // Rótulo do campo e da linha da Revisão: com pagamento simulado, nada de "recebido".
    const [rotulo, outro] = redePublica ? ['Valor recebido', 'Valor simulado'] : ['Valor simulado', 'Valor recebido'];
    expect(screen.getByRole('spinbutton', { name: rotulo })).toBeTruthy();
    expect(screen.getByTestId('revisao-acao').textContent).toMatch(new RegExp(`${rotulo}\\s*R\\$\\s*70\\.400,00`));
    expect(document.body.textContent).not.toContain(outro);
  });

  it('Enter no valor abre a Revisão e não executa', () => {
    render(<CompradorPipeline leads={[comprador]} />);
    const valor = screen.getByRole('spinbutton');
    fireEvent.submit(valor.closest('form')!);
    expect(screen.getByTestId('revisao-acao')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('valor alterado depois da Revisão: volta para a Revisão com o valor novo, sem enviar', async () => {
    render(<CompradorPipeline leads={[comprador]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Executar Caminho A' }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '71000' } });
    confirmar();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(revisao().getByRole('status').textContent).toMatch(/Os dados mudaram desde a revisão/);
    expect(screen.getByTestId('revisao-acao').textContent).toMatch(/R\$\s*71\.000,00/);
    expect((revisao().getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    confirmar();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(corpo().valorRealizado).toBe('71000');
  });
});

describe('cancelar reserva', () => {
  it('abre a Revisão; Voltar não cancela; confirmar cancela', async () => {
    render(<CompradorPipeline leads={[comprador]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));
    expect(screen.getByTestId('revisao-consequencia').textContent).toMatch(/devolve a cota à vitrine/);
    fireEvent.click(revisao().getByRole('button', { name: 'Voltar' }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));
    confirmar();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(corpo()).toEqual({ action: 'cancelar-reserva', reservaId: 'r1' });
  });
});

describe('incorporação avulsa', () => {
  const preencher = () => {
    fireEvent.change(screen.getByLabelText('Administradora', { selector: 'input' }), { target: { value: 'Porto Seguro' } });
    fireEvent.change(screen.getByLabelText('Localização aproximada', { selector: 'input' }), { target: { value: 'São Paulo - SP' } });
    fireEvent.change(screen.getByLabelText('Valor da carta (BRL)', { selector: 'input' }), { target: { value: '250000' } });
    fireEvent.change(screen.getByLabelText('Deságio aquisição (0–1)', { selector: 'input' }), { target: { value: '0.18' } });
  };

  it('enviar abre a Revisão com o aporte (função única do servidor); a action só roda na confirmação', async () => {
    render(<IncorporarCotaForm />);
    preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Incorporar cota + emitir PLINA-RF' }));
    expect(incorporar).not.toHaveBeenCalled();
    const texto = screen.getByTestId('revisao-acao').textContent!;
    expect(texto).toMatch(/Valor da carta\s*R\$\s*250\.000,00/);
    expect(texto).toMatch(/Valor do aporte \(NAV da cota\)\s*R\$\s*205\.000,00/);
    expect(texto).toContain('Stellar (rede de testes)');
    confirmar();
    await waitFor(() => expect(incorporar).toHaveBeenCalledTimes(1));
  });
});

describe('validação legal', () => {
  it('enviar abre a Revisão com a cota e o laudo; a action só roda na confirmação', async () => {
    render(<ValidacaoForm cotaId="cota0000abcd" hasValidacao={false} descricaoCota="IMOVEL · Porto Seguro · R$ 250.000" />);
    fireEvent.change(screen.getByPlaceholderText('https://…/laudo.pdf'), { target: { value: 'https://exemplo.test/laudo.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validar' }));
    expect(validar).not.toHaveBeenCalled();
    const texto = screen.getByTestId('revisao-acao').textContent!;
    expect(texto).toContain('IMOVEL · Porto Seguro · R$ 250.000');
    expect(texto).toContain('https://exemplo.test/laudo.pdf');
    confirmar();
    await waitFor(() => expect(validar).toHaveBeenCalledTimes(1));
  });
});
