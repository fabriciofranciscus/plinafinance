// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { VendedorPipeline } from '../vendedor-pipeline';
import type { CessaoAdmin, LeadAdmin } from '@/lib/admin/tipos';

const ID = 'cmlead00000a1b2c3'; // id curto A1B2C3

const cessao = (o: Partial<CessaoAdmin> = {}): CessaoAdmin => ({ id: 'c1', status: 'PENDENTE', onChainTxHash: null, pagamento: null, cota: null, ...o });
const lead = (o: { lead?: Partial<LeadAdmin>; oferta?: Record<string, unknown> | null; cessao?: CessaoAdmin | null } = {}): LeadAdmin => ({
  id: ID, nome: 'Cedente de teste', email: 'cedente@exemplo.test', status: 'OFERTA_ACEITA', criadoEm: '2026-11-14T12:00:00Z',
  ofertas: o.oferta === null ? [] : [{
    id: 'o1', versao: 1, tipoBem: 'IMOVEL', valorCarta: '150000', valorLiquidoVendedor: '120000', desagioAquisicao: '0.2',
    administradora: 'Administradora', status: 'ACEITA', validade: '2026-12-01T00:00:00Z',
    cessao: o.cessao === undefined ? null : o.cessao, ...(o.oferta ?? {}),
  }],
  ...(o.lead ?? {}),
});
/** Cessão ASSINADA com titular único, laudo e anuência: base para as etapas finais. */
const assinada = (o: Partial<CessaoAdmin> = {}) => cessao({ status: 'ASSINADA', laudoRegistrado: true, laudoHash: 'a'.repeat(64), titularSituacao: 'TITULAR_UNICO', ...o });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  refresh.mockClear();
  fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const abrir = (id = 'A1B2C3') => fireEvent.click(within(screen.getByTestId('lista-tabela')).getByRole('link', { name: id }));
const detalhe = () => within(screen.getByTestId('detalhe'));
const agora = () => within(screen.getByTestId('etapa-agora'));
const corpo = (i = 0) => JSON.parse(String((fetchMock.mock.calls[i]![1] as RequestInit).body));
const montar = (leads: LeadAdmin[], redePublica = false) => render(<VendedorPipeline leads={leads} redePublica={redePublica} />);
const resposta = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

describe('lista de solicitações', () => {
  it('tabela semântica: id curto (link), cedente, valor, etapa e próxima ação; nome ausente e proposta ausente em texto', () => {
    const semNome = lead({ lead: { id: 'x0000000zz9f00', nome: 'cedente2@exemplo.test', email: 'cedente2@exemplo.test', status: 'DOCS_RECEBIDOS' }, oferta: null });
    montar([lead({ oferta: { status: 'ENVIADA' } }), semNome]);
    const t = within(screen.getByTestId('lista-tabela'));
    expect(t.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['ID', 'Cedente', 'Valor da carta', 'Etapa', 'Próxima ação']);
    const linhas = t.getAllByRole('row').slice(1);
    // o que depende do operador vem antes do que aguarda o cedente
    expect(linhas[0]!.textContent).toContain('ZZ9F00');
    expect(linhas[0]!.textContent).toContain('Nome não informado');
    expect(linhas[0]!.textContent).toContain('sem proposta');
    expect(linhas[0]!.textContent).toContain('Gerar proposta');
    expect(linhas[1]!.textContent).toContain('A1B2C3');
    expect(linhas[1]!.textContent).toMatch(/R\$\s150\.000/);
    expect(linhas[1]!.textContent).toContain('2 · Aceite do cedente');
    expect(linhas[1]!.textContent).toContain('Aguardando o cedente');
    expect(linhas[1]!.textContent).not.toContain('→');
  });

  it('filtros Abertas / Concluídas / Encerradas com contagem derivada; vazio de filtro distinto', () => {
    const concl = lead({ lead: { id: 'c0000000000cc01', status: 'COTA_INCORPORADA' }, cessao: assinada({ anuenciaStatus: 'CONFIRMADA', pixStatus: 'COMPROVADA', pagamento: { id: 'p', status: 'EXECUTADO', onChainTxHash: null }, cota: { id: 'cota1' } }) });
    const enc = lead({ lead: { id: 'e0000000000ee02', status: 'PERDIDO' }, oferta: { status: 'ENVIADA' } });
    montar([lead(), concl, enc]);
    const grupo = screen.getByRole('group', { name: 'Filtrar solicitações' });
    expect(within(grupo).getByRole('button', { name: 'Abertas (1)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(grupo).getByRole('button', { name: 'Concluídas (1)' }));
    expect(within(screen.getByTestId('lista-tabela')).getAllByRole('row')).toHaveLength(2);
    fireEvent.click(within(grupo).getByRole('button', { name: 'Encerradas (1)' }));
    expect(within(screen.getByTestId('lista-tabela')).getByRole('link', { name: 'EE02'.padStart(6, '0').slice(-6) }).textContent).toBeTruthy();
  });

  it('sem leads: "Nenhuma solicitação aberta."; filtro sem resultado: texto do filtro', () => {
    const u = render(<VendedorPipeline leads={[]} />);
    expect(screen.getByText(/Nenhuma solicitação aberta\./)).toBeTruthy();
    u.unmount();
    montar([lead()]);
    fireEvent.click(screen.getByRole('button', { name: 'Concluídas (0)' }));
    expect(screen.getByText('Nenhuma solicitação concluída.')).toBeTruthy();
  });

  it('desktop sem seleção: "Escolha uma solicitação na lista."; clicar seleciona (aria-current + "Selecionado") e grava #lead-<id>', () => {
    montar([lead()]);
    expect(screen.getByText('Escolha uma solicitação na lista.')).toBeTruthy();
    abrir();
    expect(within(screen.getByTestId('lista-tabela')).getByRole('link', { name: 'A1B2C3' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('Selecionado')).toBeTruthy();
    expect(window.location.hash).toBe(`#lead-${ID}`);
    expect(screen.queryByText('Escolha uma solicitação na lista.')).toBeNull();
  });

  it('#lead-<id> na URL abre o detalhe daquele lead (mesmo concluído, mudando o filtro)', async () => {
    window.history.replaceState(null, '', `#lead-${ID}`);
    montar([lead()]);
    await waitFor(() => expect(screen.getByTestId('detalhe')).toBeTruthy());
  });

  it('celular: lista de três linhas por solicitação; abrir mostra o detalhe com "← Solicitações" que volta à lista', () => {
    montar([lead()]);
    const item = within(screen.getByTestId('lista-mobile')).getByRole('button', { name: /A1B2C3/ });
    expect(item.textContent).toContain('Cedente de teste');
    expect(item.textContent).toMatch(/R\$\s150\.000/);
    expect(item.textContent).toContain('Registrar cessão');
    fireEvent.click(item);
    expect(screen.getByTestId('detalhe')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Solicitações' }));
    expect(screen.queryByTestId('detalhe')).toBeNull();
  });
});

describe('detalhe: só a etapa "Agora" tem controles', () => {
  it('cabeçalho: id, etapa, cedente, oferta; etapas futuras só rótulo e "depois da etapa N", sem botões', () => {
    montar([lead({ cessao: cessao({ laudoRegistrado: false }) })]);
    abrir();
    expect(detalhe().getByText('Solicitação #A1B2C3')).toBeTruthy();
    expect(screen.getByTestId('detalhe').textContent).toMatch(/Imóvel · carta R\$\s150\.000 · líquido R\$\s120\.000 · Administradora/);
    const ag = screen.getByTestId('etapa-agora');
    expect(ag.getAttribute('aria-current')).toBe('step');
    expect(ag.textContent).toContain('4');
    expect(ag.textContent).toContain('Registrar laudo');
    // nada de botão para etapas futuras
    for (const nome of [/Enviar para assinatura/, /Pagar cedente/, /Incorporar cota/, /Registrar anuência/, /Confirmar titular/]) {
      expect(screen.queryByRole('button', { name: nome })).toBeNull();
    }
    expect(screen.getByText(/Enviada para assinatura/).textContent).toContain('depois da etapa 4');
  });

  it('etapas concluídas: data e evidência reais; tx com link do explorer em nova aba, hash curto e "copiar"', () => {
    montar([lead({ cessao: assinada({ onChainTxHash: 'b'.repeat(64), assinadaEm: '2026-11-15T12:00:00Z', laudoEm: '2026-11-15T10:00:00Z', anuenciaStatus: undefined }) })]);
    abrir();
    const concl = detalhe().getByText(/Etapas concluídas/).closest('details')!;
    fireEvent.click(within(concl).getByText(/Etapas concluídas/));
    const link = within(concl).getByRole('link', { name: /Transação bbbb…bbbb no explorer, abre em nova aba/ });
    expect(link.getAttribute('href')).toBe(`https://stellar.expert/explorer/testnet/tx/${'b'.repeat(64)}`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(within(concl).getAllByRole('button', { name: /Copiar/ }).length).toBeGreaterThan(0);
    expect(within(concl).getByRole('link', { name: 'Ver comprovante' }).getAttribute('href')).toBe('/cessao/c1/comprovante');
    expect(concl.textContent).toMatch(/Laudo registrado · \d{2}\/\d{2}/);
    // etapa sem data real não inventa uma
    expect(within(concl).getByText(/Proposta aceita pelo cedente/).textContent).not.toMatch(/\d{2}\/\d{2}/);
  });

  it('1 proposta: o formulário mora na etapa e envia gerar-oferta com prazo NÚMERO (0 = quitada) e valores string', async () => {
    montar([lead({ oferta: null, lead: { status: 'DOCS_RECEBIDOS' } })]);
    abrir();
    const f = document.querySelector('[data-testid="etapa-agora"] form')!;
    const set = (n: string, v: string) => fireEvent.change(f.querySelector(`[name="${n}"]`)!, { target: { value: v } });
    set('valorCarta', '150000'); set('administradora', 'Caixa'); set('desagioAquisicao', '0.20'); set('prazoRestanteMeses', '0');
    fireEvent.submit(f);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const b = corpo();
    expect(b).toMatchObject({ action: 'gerar-oferta', leadVendedorId: ID, valorCarta: '150000', desagioAquisicao: '0.20', prazoRestanteMeses: 0, validadeHoras: 48 });
    expect(typeof b.prazoRestanteMeses).toBe('number');
  });

  it('1 proposta: prazo em branco é omitido', async () => {
    montar([lead({ oferta: null, lead: { status: 'DOCS_RECEBIDOS' } })]);
    abrir();
    const f = document.querySelector('[data-testid="etapa-agora"] form')!;
    const set = (n: string, v: string) => fireEvent.change(f.querySelector(`[name="${n}"]`)!, { target: { value: v } });
    set('valorCarta', '150000'); set('administradora', 'Caixa'); set('desagioAquisicao', '0.20');
    fireEvent.submit(f);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).not.toHaveProperty('prazoRestanteMeses');
  });

  it('A-01: o campo de prazo aceita 0 a 600 inteiros e o rótulo diz que 0 = quitada; a dica do deságio aparece', () => {
    montar([lead({ oferta: null, lead: { status: 'DOCS_RECEBIDOS' } })]);
    abrir();
    const el = document.querySelector('[name="prazoRestanteMeses"]') as HTMLInputElement;
    expect([el.min, el.max, el.step]).toEqual(['0', '600', '1']);
    expect(screen.getByText('Prazo restante (meses) — 0 = quitada')).toBeTruthy();
    expect(screen.getByText(/Preencher o prazo aumenta o deságio da proposta/)).toBeTruthy();
  });

  const formularioDaProposta = () => {
    montar([lead({ oferta: null, lead: { status: 'DOCS_RECEBIDOS' } })]);
    abrir();
    const f = document.querySelector('[data-testid="etapa-agora"] form')!;
    const set = (n: string, v: string) => fireEvent.change(f.querySelector(`[name="${n}"]`)!, { target: { value: v } });
    return set;
  };

  it('A-08: "Ver prévia" chama previa-oferta (sem tipoBem, sem gerar) e mostra deságio final e valor líquido; mexer num campo limpa a prévia', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ desagioBase: '0.2000', taxaAnuenciaBps: '150', taxaPrazoBps: 200, desagioTotal: '0.2350', valorLiquido: '114750.00' }));
    const set = formularioDaProposta();
    set('valorCarta', '150000'); set('administradora', 'Caixa'); set('desagioAquisicao', '0.20'); set('prazoRestanteMeses', '18');
    fireEvent.click(screen.getByRole('button', { name: 'Ver prévia' }));
    const previa = await screen.findByTestId('previa-oferta');
    expect(previa.textContent?.replace(/\u00a0/g, ' ')).toBe('Deságio final 23,50% (base 20,00% + anuência 1,50% + prazo 2,00%) · Valor líquido ao cedente R$ 114.750,00');
    expect(corpo()).toEqual({ action: 'previa-oferta', valorCarta: '150000', administradora: 'Caixa', desagioAquisicao: '0.20', prazoRestanteMeses: 18 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    set('valorCarta', '160000');
    await waitFor(() => expect(screen.queryByTestId('previa-oferta')).toBeNull());
  });

  it('A-08: erro da prévia aparece como mensagem fixa da API + código; nada é gerado', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ error: 'Parâmetros inválidos.', code: 'ENTRADA_INVALIDA' }, 400));
    const set = formularioDaProposta();
    set('valorCarta', '150000'); set('administradora', 'Caixa'); set('desagioAquisicao', '0.20');
    fireEvent.click(screen.getByRole('button', { name: 'Ver prévia' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Parâmetros inválidos.ENTRADA_INVALIDA');
    expect(screen.queryByTestId('previa-oferta')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(corpo().action).toBe('previa-oferta');
  });

  it('2 aceite do cedente: sem botão, só o texto com a validade', () => {
    montar([lead({ oferta: { status: 'ENVIADA' }, lead: { status: 'OFERTA_ENVIADA' } })]);
    abrir();
    expect(screen.getByTestId('etapa-agora').textContent).toMatch(/Aguardando o cedente · válida até \d{2}\/\d{2}/);
    expect(within(screen.getByTestId('etapa-agora')).queryAllByRole('button')).toHaveLength(0);
  });

  it('3 registrar cessão envia só registrar-cessao', async () => {
    montar([lead()]);
    abrir();
    fireEvent.click(agora().getByRole('button', { name: 'Registrar cessão' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toEqual({ action: 'registrar-cessao', ofertaId: 'o1' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('4 laudo: URL obrigatória (http/https), lembrete do item 7, payload com laudoUrl', async () => {
    montar([lead({ cessao: cessao({ laudoRegistrado: false }) })]);
    abrir();
    const botao = agora().getByRole('button', { name: 'Registrar laudo' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(screen.getByText(/item 7 \(quitação\): saldo devedor R\$ 0,00/)).toBeTruthy();
    fireEvent.change(agora().getByPlaceholderText(/laudo\.pdf#sha256/), { target: { value: 'https://exemplo.test/laudo.pdf#sha256=abc' } });
    fireEvent.click(botao);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toEqual({ action: 'registrar-laudo', cessaoId: 'c1', laudoUrl: 'https://exemplo.test/laudo.pdf#sha256=abc' });
  });

  it('5 enviar para assinatura; 6 aguardando: sem botão primário, só "Sincronizar assinatura" secundário', async () => {
    montar([lead({ cessao: cessao({ laudoRegistrado: true }) })]);
    abrir();
    fireEvent.click(agora().getByRole('button', { name: /Enviar para assinatura/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toEqual({ action: 'enviar-cessao', cessaoId: 'c1' });
    cleanup();
    fetchMock.mockClear();
    montar([lead({ cessao: cessao({ status: 'ENVIADA_DOCUSIGN', laudoRegistrado: true }) })]);
    abrir();
    expect(screen.getByTestId('cessao-aguardando-assinatura').textContent).toBe('Aguardando assinatura do cedente.');
    expect(agora().getAllByRole('button').map((b) => b.textContent)).toEqual(['Sincronizar assinatura']);
    fireEvent.click(agora().getByRole('button', { name: 'Sincronizar assinatura' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toEqual({ action: 'sincronizar-cessoes', cessaoId: 'c1' });
  });

  it('6 sincronizar com 200 AGUARDANDO não é sucesso: mostra aviso informativo', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ processadas: 1, resultados: [{ resultado: 'AGUARDANDO' }] }));
    montar([lead({ cessao: cessao({ status: 'ENVIADA_DOCUSIGN', laudoRegistrado: true }) })]);
    abrir();
    fireEvent.click(agora().getByRole('button', { name: 'Sincronizar assinatura' }));
    expect((await screen.findByTestId('aviso-acao')).textContent).toBe('O cedente ainda não assinou. Tente sincronizar mais tarde.');
  });

  it('7 titular: exige o atestado; payload com situação e atestado', async () => {
    montar([lead({ cessao: cessao({ status: 'ASSINADA', laudoRegistrado: true }) })]);
    abrir();
    const botao = agora().getByRole('button', { name: 'Confirmar titular do laudo' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(screen.getByText(/Atesto que o titular indicado no laudo é o titular do CPF do cadastro do cedente \(na testnet/)).toBeTruthy();
    fireEvent.click(agora().getByRole('checkbox'));
    expect(botao.disabled).toBe(false);
    fireEvent.click(botao);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toEqual({ action: 'confirmar-titular-laudo', cessaoId: 'c1', situacao: 'TITULAR_UNICO', atestado: true });
  });

  it('8 anuência: hash do laudo; "Confirmada" exige referência; na rede pública não oferece "Declarada, pendente"', async () => {
    montar([lead({ cessao: assinada() })]);
    abrir();
    fireEvent.click(agora().getByRole('button', { name: 'Registrar anuência' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toEqual({ action: 'registrar-anuencia', hashValidacao: 'a'.repeat(64), status: 'DECLARADA_PENDENTE' });
    cleanup();
    fetchMock.mockClear();
    montar([lead({ cessao: assinada() })]);
    abrir();
    fireEvent.change(agora().getByRole('combobox', { name: /Anuência da administradora/ }), { target: { value: 'CONFIRMADA' } });
    const botao = agora().getByRole('button', { name: 'Registrar anuência' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(agora().getByLabelText(/Referência do documento da administradora/), { target: { value: 'PROTOCOLO-TESTE' } });
    expect(botao.disabled).toBe(false);
    cleanup();
    montar([lead({ cessao: assinada() })], true);
    abrir();
    expect(screen.queryByRole('option', { name: /Declarada, pendente/ })).toBeNull();
  });

  it('9 pagar: Pix simulado fora da rede pública; nunca o Pix avulso antigo', async () => {
    const base = { anuenciaStatus: 'DECLARADA_PENDENTE' };
    montar([lead({ cessao: assinada(base) })]);
    abrir();
    expect(screen.queryByRole('button', { name: /Executar Pix simulado/i })).toBeNull();
    fireEvent.click(agora().getByRole('button', { name: 'Pagar cedente (Pix simulado, rede de testes)' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toEqual({ action: 'pagar-cedente', cessaoId: 'c1' });
    cleanup();
    montar([lead({ cessao: assinada(base) })], true);
    abrir();
    expect(agora().getByRole('button', { name: 'Pagar cedente (Pix)' })).toBeTruthy();
  });

  it('9 Pix em andamento: reconsultar (nunca novo pagamento); FALHOU: só reabrir', async () => {
    montar([lead({ cessao: assinada({ anuenciaStatus: 'CONFIRMADA', pixStatus: 'PROCESSANDO' }) })]);
    abrir();
    expect(agora().queryByRole('button', { name: /Pagar cedente/ })).toBeNull();
    expect(agora().getByText(/Pix em andamento \(PROCESSANDO\)\. Reconsultar não paga de novo\./)).toBeTruthy();
    fireEvent.click(agora().getByRole('button', { name: 'Reconsultar pagamento' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo().action).toBe('pagar-cedente');
    cleanup();
    fetchMock.mockClear();
    montar([lead({ cessao: assinada({ anuenciaStatus: 'CONFIRMADA', pixStatus: 'FALHOU' }) })]);
    abrir();
    expect(agora().getAllByRole('button').map((b) => b.textContent)).toEqual(['Reabrir pagamento']);
    fireEvent.click(agora().getByRole('button', { name: 'Reabrir pagamento' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toEqual({ action: 'reabrir-pagamento-cedente', cessaoId: 'c1' });
  });

  it('9 pagar com 200 PROCESSANDO/INCERTO não é "pago": aviso, sem mandar repetir o pagamento', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ status: 'INCERTO' }));
    montar([lead({ cessao: assinada({ anuenciaStatus: 'CONFIRMADA' }) })]);
    abrir();
    fireEvent.click(agora().getByRole('button', { name: /Pagar cedente/ }));
    expect((await screen.findByTestId('aviso-acao')).textContent).toMatch(/não repita o pagamento/);
  });

  it('10 incorporar: botão com a ação; em execução mostra "Incorporando…" e o aviso de processamento (sem prometer prazo)', async () => {
    let liberar: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { liberar = r; }));
    montar([lead({ cessao: assinada({ anuenciaStatus: 'CONFIRMADA', pixStatus: 'COMPROVADA', pagamento: { id: 'p', status: 'EXECUTADO', onChainTxHash: null } }) })]);
    abrir();
    fireEvent.click(agora().getByRole('button', { name: 'Incorporar cota ao pool · emitir PLINA-RF' }));
    const ocupado = await agora().findByRole('button', { name: 'Incorporando…' });
    expect((ocupado as HTMLButtonElement).disabled).toBe(true);
    expect(agora().getByText('Processando. Aguarde a confirmação antes de repetir.')).toBeTruthy();
    expect(screen.getByTestId('etapa-agora').textContent).not.toMatch(/2 minutos|120 s/);
    expect(corpo()).toEqual({ action: 'incorporar-cota', cessaoId: 'c1' });
    liberar(resposta({}));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe('razão visível quando o botão está desabilitado e largura total (revisão da Íris)', () => {
  it('titular: "Marque o atesto para confirmar o titular." some ao marcar; botão ligado à razão por aria-describedby', () => {
    montar([lead({ cessao: cessao({ status: 'ASSINADA', laudoRegistrado: true }) })]);
    abrir();
    const botao = agora().getByRole('button', { name: 'Confirmar titular do laudo' });
    expect(agora().getByText('Marque o atesto para confirmar o titular.').id).toBe(botao.getAttribute('aria-describedby'));
    fireEvent.click(agora().getByRole('checkbox'));
    expect(agora().queryByText('Marque o atesto para confirmar o titular.')).toBeNull();
  });
  it('laudo: pede a URL; anuência Confirmada: pede a referência', () => {
    montar([lead({ cessao: cessao({ laudoRegistrado: false }) })]);
    abrir();
    expect(agora().getByText('Informe a URL do laudo (começando com http ou https).')).toBeTruthy();
    fireEvent.change(agora().getByPlaceholderText(/laudo\.pdf#sha256/), { target: { value: 'https://exemplo.test/l.pdf#sha256=a' } });
    expect(agora().queryByText(/Informe a URL do laudo/)).toBeNull();
    cleanup();
    montar([lead({ cessao: assinada() })]);
    abrir();
    fireEvent.change(agora().getByRole('combobox', { name: /Anuência da administradora/ }), { target: { value: 'CONFIRMADA' } });
    expect(agora().getByText('Informe a referência do documento da administradora.')).toBeTruthy();
  });
  it('botões de ação ocupam a largura total abaixo de lg (classe responsiva)', () => {
    montar([lead()]);
    abrir();
    expect(agora().getByRole('button', { name: 'Registrar cessão' }).className).toContain('w-full lg:w-auto');
  });
  it('etapa 2 concluída sem data: diz "data do aceite não disponível" (não inventa data)', () => {
    montar([lead({ cessao: cessao({ laudoRegistrado: false }) })]);
    abrir();
    fireEvent.click(screen.getByText(/Etapas concluídas/));
    expect(screen.getByText(/data do aceite não disponível/)).toBeTruthy();
  });
  it('tabela com colunas de largura fixa: nada vaza por baixo do painel (F-UX-1)', () => {
    montar([lead()]);
    const t = screen.getByTestId('lista-tabela');
    expect(t.className).toContain('table-fixed');
    expect(t.querySelectorAll('col')).toHaveLength(5);
  });
});

describe('estados fora da linha reta', () => {
  it('titular diferente de titular único: para com a razão, sem botão que avance', () => {
    montar([lead({ cessao: assinada({ titularSituacao: 'ESPOLIO' }) })]);
    abrir();
    expect(screen.queryByTestId('etapa-agora')).toBeNull();
    expect(screen.getByText('Fora do fluxo automático. Tratamento manual pela equipe.')).toBeTruthy();
    expect(within(screen.getByTestId('detalhe')).queryAllByRole('button').filter((b) => !/concluídas|Solicitações|copiar/i.test(b.textContent ?? ''))).toHaveLength(0);
  });

  it('encerrada e concluída: nenhuma etapa "Agora" e nenhum botão de avanço', () => {
    montar([lead({ lead: { status: 'PERDIDO' }, oferta: { status: 'ENVIADA' } })]);
    fireEvent.click(screen.getByRole('button', { name: /Encerradas/ }));
    abrir();
    expect(screen.queryByTestId('etapa-agora')).toBeNull();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Encerrada');
  });
});

describe('erros e resultado incerto (checklist do item 14)', () => {
  const abrirEnvio = () => {
    montar([lead({ cessao: cessao({ laudoRegistrado: true }) })]);
    abrir();
    fireEvent.click(agora().getByRole('button', { name: /Enviar para assinatura/ }));
  };

  it('código conhecido: mensagem segura dentro da etapa, logo abaixo do botão, e o código numa segunda linha', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ error: 'Envio recusado: falta o laudo.', code: 'LAUDO_AUSENTE', detalhe: 'segredo' }, 409));
    abrirEnvio();
    const alerta = await agora().findByRole('alert');
    expect(alerta.textContent).toContain('Envio recusado: falta o laudo.');
    expect(within(alerta).getByText('LAUDO_AUSENTE').className).toContain('font-mono');
    expect(document.body.textContent).not.toContain('segredo');
  });

  it('503 DOCUSIGN_*: mensagem pronta do servidor com o código', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ error: 'O DocuSign não está configurado neste ambiente.', code: 'DOCUSIGN_NAO_CONFIGURADO' }, 503));
    abrirEnvio();
    const alerta = await agora().findByRole('alert');
    expect(alerta.textContent).toContain('O DocuSign não está configurado neste ambiente.');
    expect(alerta.textContent).toContain('DOCUSIGN_NAO_CONFIGURADO');
  });

  it('401: sessão expirada com link para /admin; sem afirmar "ação não enviada"', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ error: 'unauthorized' }, 401));
    abrirEnvio();
    const alerta = await agora().findByRole('alert');
    expect(alerta.textContent).toContain('Sessão expirada. Entre novamente para continuar.');
    expect(within(alerta).getByRole('link', { name: 'Entrar de novo' }).getAttribute('href')).toBe('/admin');
    expect(alerta.textContent).not.toMatch(/não enviada|não foi enviada/i);
  });

  it('o erro leva rótulo em texto (não só cor): "Não concluído" para recusa conhecida e "Sem confirmação" para resultado incerto', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ error: 'Envio recusado: falta o laudo.', code: 'LAUDO_AUSENTE' }, 409));
    abrirEnvio();
    expect((await agora().findByRole('alert')).textContent).toContain('Não concluído');
    cleanup();
    fetchMock.mockResolvedValueOnce(resposta({ error: 'erro interno' }, 500));
    abrirEnvio();
    expect((await agora().findByRole('alert')).textContent).toContain('Sem confirmação');
  });

  it('429 respeita Retry-After; 500 e falha de rede: resultado incerto, conferir antes de repetir', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ error: 'too many requests' }, 429, { 'retry-after': '30' }));
    abrirEnvio();
    expect((await agora().findByRole('alert')).textContent).toContain('Aguarde 30 s');
    cleanup();
    fetchMock.mockResolvedValueOnce(resposta({ error: 'erro interno' }, 500));
    abrirEnvio();
    expect((await agora().findByRole('alert')).textContent).toContain('A ação pode ter sido executada: recarregue a página e confira antes de repetir.');
    cleanup();
    fetchMock.mockRejectedValueOnce(new Error('rede'));
    abrirEnvio();
    expect((await agora().findByRole('alert')).textContent).toContain('A ação pode ter sido executada');
  });

  it('422 do deságio (A-22): a mensagem do corpo aparece', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ error: 'Deságio total acima de 100%.' }, 422));
    montar([lead({ oferta: null, lead: { status: 'DOCS_RECEBIDOS' } })]);
    abrir();
    const f = document.querySelector('[data-testid="etapa-agora"] form')!;
    const set = (n: string, v: string) => fireEvent.change(f.querySelector(`[name="${n}"]`)!, { target: { value: v } });
    set('valorCarta', '150000'); set('administradora', 'Caixa'); set('desagioAquisicao', '0.99');
    fireEvent.submit(f);
    const alerta = await agora().findByRole('alert');
    expect(alerta.textContent).toContain('Deságio total acima de 100%.');
    expect(alerta.textContent).toContain('Não concluído');
  });
});
