import { describe, expect, it } from 'vitest';
import {
  atribuirResposta,
  classificarRetorno,
  confirmar,
  editar,
  estadoInicial,
  fechar,
  marcarAtesto,
  paraFormData,
  podeTrocarDeAlvo,
  preparar,
  reabrir,
  revisar,
  validarDados,
  voltar,
  cancelar,
  concluirRegistro,
  novoPedido,
  type Estado,
} from '@/lib/admin/clawback-fluxo';

// U1-11 PR 1 (spec da Íris, admin-clawback/SPEC.md): máquina de estados pura do clawback. Sem UI, sem texto.
const ALVO = 'inv-1';
const dadosOk = { amount: '139.6', motivo: 'DECISAO_JUDICIAL' as const, fundamentoUrl: 'https://exemplo.test/decisao.pdf' };

/** Caminho feliz até a Revisão (dados válidos e atesto marcado). */
function ateRevisaoComAtesto(): Estado {
  let e = preparar(estadoInicial(ALVO));
  e = editar(e, 'amount', dadosOk.amount);
  e = editar(e, 'motivo', dadosOk.motivo);
  e = editar(e, 'fundamentoUrl', dadosOk.fundamentoUrl);
  e = revisar(e);
  return marcarAtesto(e, true);
}

describe('validação local dos dados (mesma regra do servidor)', () => {
  it('quantidade: decimal puro, até 12 inteiros e 7 casas, maior que zero', () => {
    for (const ok of ['1', '139.6', '0.1234567', '999999999999', '0.0000001', '1.0']) expect(validarDados({ ...dadosOk, amount: ok }).amount, ok).toBeUndefined();
    for (const ruim of ['', '0', '0.0', '-1', '1e3', '1e-7', '1,5', '0.12345678', '1000000000000', '.5', '1.', 'abc', ' ']) expect(validarDados({ ...dadosOk, amount: ruim }).amount, ruim).toBeDefined();
  });
  it('motivo: só as quatro hipóteses atuais', () => {
    expect(validarDados({ ...dadosOk, motivo: '' }).motivo).toBeDefined();
    expect(validarDados({ ...dadosOk, motivo: 'OUTRO' as never }).motivo).toBeDefined();
    for (const m of ['DECISAO_JUDICIAL', 'SANCAO_REGULATORIA', 'FRAUDE_DOCUMENTAL', 'ERRO_OPERACIONAL'] as const) expect(validarDados({ ...dadosOk, motivo: m }).motivo).toBeUndefined();
  });
  it('fundamento: http(s) depois do trim', () => {
    expect(validarDados({ ...dadosOk, fundamentoUrl: '' }).fundamentoUrl).toBeDefined();
    expect(validarDados({ ...dadosOk, fundamentoUrl: 'ftp://x' }).fundamentoUrl).toBeDefined();
    expect(validarDados({ ...dadosOk, fundamentoUrl: 'javascript:alert(1)' }).fundamentoUrl).toBeDefined();
    expect(validarDados({ ...dadosOk, fundamentoUrl: '  https://x.test/a  ' }).fundamentoUrl).toBeUndefined();
  });
});

describe('Dados → Revisão (local, nunca chama o servidor)', () => {
  it('preparar abre Dados vazio, sem valor nem motivo pré-selecionado', () => {
    const e = preparar(estadoInicial(ALVO));
    expect(e).toMatchObject({ tipo: 'dados', dados: { amount: '', motivo: '', fundamentoUrl: '' } });
  });
  it('revisar com erro fica em Dados e aponta os campos; com tudo certo vai para Revisão com o atesto desmarcado', () => {
    let e = preparar(estadoInicial(ALVO));
    e = revisar(e);
    expect(e).toMatchObject({ tipo: 'dados' });
    expect((e as { erros: object }).erros).toMatchObject({ amount: expect.anything(), motivo: expect.anything(), fundamentoUrl: expect.anything() });
    e = editar(editar(editar(e, 'amount', '5'), 'motivo', 'ERRO_OPERACIONAL'), 'fundamentoUrl', 'https://x.test/p');
    e = revisar(e);
    expect(e).toMatchObject({ tipo: 'revisao', atesto: false });
  });
  it('voltar da Revisão para Dados desmarca o atesto e mantém o que foi digitado', () => {
    const e = voltar(ateRevisaoComAtesto());
    expect(e).toMatchObject({ tipo: 'dados', dados: dadosOk });
    expect(revisar(e)).toMatchObject({ tipo: 'revisao', atesto: false });
  });
  it('na Revisão os campos não se editam (qualquer alteração exige voltar)', () => {
    const e = ateRevisaoComAtesto();
    expect(editar(e, 'amount', '999')).toBe(e);
  });
  it('cancelar descarta o rascunho e volta ao repouso', () => {
    expect(cancelar(editar(preparar(estadoInicial(ALVO)), 'amount', '1'))).toMatchObject({ tipo: 'repouso' });
  });
});

describe('Envio: só a confirmação envia, com os cinco campos congelados', () => {
  it('confirmar exige Revisão com atesto; sem atesto não muda nada', () => {
    const semAtesto = marcarAtesto(ateRevisaoComAtesto(), false);
    expect(confirmar(semAtesto, 'ped-1')).toBe(semAtesto);
    expect(confirmar(preparar(estadoInicial(ALVO)), 'ped-1')).toMatchObject({ tipo: 'dados' });
  });
  it('congela investidorId, pedidoId, quantidade exata, motivo e URL (trim); "1.0" não vira "1"', () => {
    let e = preparar(estadoInicial(ALVO));
    e = editar(editar(editar(e, 'amount', '1.0'), 'motivo', 'FRAUDE_DOCUMENTAL'), 'fundamentoUrl', '  https://x.test/f  ');
    e = marcarAtesto(revisar(e), true);
    const env = confirmar(e, 'ped-9');
    expect(env).toMatchObject({ tipo: 'envio', envio: { investidorId: ALVO, pedidoId: 'ped-9', amount: '1.0', motivo: 'FRAUDE_DOCUMENTAL', fundamentoUrl: 'https://x.test/f' } });
  });
  it('duplo clique: confirmar de novo em envio é no-op (mesmo estado, mesma chave)', () => {
    const env = confirmar(ateRevisaoComAtesto(), 'ped-1');
    expect(confirmar(env, 'ped-2')).toBe(env);
  });
  it('durante o envio nada se edita nem se volta', () => {
    const env = confirmar(ateRevisaoComAtesto(), 'ped-1');
    expect(editar(env, 'amount', '2')).toBe(env);
    expect(voltar(env)).toBe(env);
    expect(cancelar(env)).toBe(env);
  });
  it('FormData com exatamente os cinco campos que a action lê', () => {
    const env = confirmar(ateRevisaoComAtesto(), 'ped-1') as Extract<Estado, { tipo: 'envio' }>;
    const fd = paraFormData(env.envio);
    expect([...fd.keys()].sort()).toEqual(['amount', 'fundamentoUrl', 'investidorId', 'motivo', 'pedidoId']);
    expect(fd.get('amount')).toBe('139.6');
    expect(fd.get('pedidoId')).toBe('ped-1');
  });
});

describe('classificação dos retornos da action (tabela 6 da spec)', () => {
  const c = (r: Parameters<typeof classificarRetorno>[0]) => classificarRetorno(r);
  it('ok → confirmado; ok + idempotente → já executado (mesma prova)', () => {
    expect(c({ ok: true, txHash: 'h' })).toMatchObject({ classe: 'confirmado', txHash: 'h', camposTravados: false });
    expect(c({ ok: true, txHash: 'h', idempotente: true })).toMatchObject({ classe: 'ja_executado', txHash: 'h' });
  });
  it('REGISTRO_PENDENTE: rede executou, registro falta; pode concluir registro com os mesmos dados; mantém a chave', () => {
    expect(c({ ok: false, code: 'REGISTRO_PENDENTE', txHash: 'h', error: 'x' })).toMatchObject({ classe: 'registro_pendente', txHash: 'h', camposTravados: true, manterPedidoId: true, podeConcluirRegistro: true, podeNovoPedido: false });
  });
  it('EXECUCAO_INCERTA e PEDIDO_EM_ANDAMENTO: incerto, campos travados, sem novo pedido', () => {
    for (const code of ['EXECUCAO_INCERTA', 'PEDIDO_EM_ANDAMENTO']) expect(c({ ok: false, code, error: 'x' }), code).toMatchObject({ classe: 'incerto', camposTravados: true, manterPedidoId: true, podeNovoPedido: false, podeConcluirRegistro: false });
  });
  it('EXECUCAO_FALHOU e PEDIDO_FALHOU: recusa definitiva; novo pedido só por escolha, e NÃO mantém a chave', () => {
    for (const code of ['EXECUCAO_FALHOU', 'PEDIDO_FALHOU']) expect(c({ ok: false, code, error: 'x' }), code).toMatchObject({ classe: 'falhou', podeNovoPedido: true, manterPedidoId: false, camposTravados: false });
  });
  it('VALOR_INVALIDO e FUNDAMENTO_INVALIDO: voltam aos Dados no campo certo (nada foi executado)', () => {
    expect(c({ ok: false, code: 'VALOR_INVALIDO', error: 'x' })).toMatchObject({ classe: 'campo_invalido', campo: 'amount' });
    expect(c({ ok: false, code: 'FUNDAMENTO_INVALIDO', error: 'x' })).toMatchObject({ classe: 'campo_invalido', campo: 'fundamentoUrl' });
  });
  it('PEDIDO_INVALIDO: conferir, sem reenvio cego e sem renovar a chave', () => {
    expect(c({ ok: false, code: 'PEDIDO_INVALIDO', error: 'x' })).toMatchObject({ classe: 'pedido_invalido', manterPedidoId: true, podeNovoPedido: false });
  });
  it('INVESTIDOR_NAO_ENCONTRADO e EMISSOR_NAO_CONFIGURADO: ação indisponível', () => {
    for (const code of ['INVESTIDOR_NAO_ENCONTRADO', 'EMISSOR_NAO_CONFIGURADO']) expect(c({ ok: false, code, error: 'x' }), code).toMatchObject({ classe: 'indisponivel' });
  });
  it('SEM código ("erro interno"), código desconhecido ou exceção: INCERTO e mantém a chave (o bug do formulário atual era renová-la)', () => {
    for (const r of [{ ok: false, error: 'erro interno' }, { ok: false, code: 'CODIGO_NOVO', error: 'x' }, null, undefined, 'falha' as never]) {
      expect(c(r as never), String(r)).toMatchObject({ classe: 'incerto', manterPedidoId: true, camposTravados: true, podeNovoPedido: false });
    }
  });
  it('a mensagem do servidor passa como veio (texto fixo do serviço, nunca reescrito aqui)', () => {
    expect(c({ ok: false, code: 'VALOR_INVALIDO', error: 'Informe uma quantidade válida' })).toMatchObject({ mensagem: 'Informe uma quantidade válida' });
  });
});

describe('resposta aplicada ao estado', () => {
  const emEnvio = () => confirmar(ateRevisaoComAtesto(), 'ped-1');
  it('só se aplica a um envio em andamento', () => {
    const e = ateRevisaoComAtesto();
    expect(atribuirResposta(e, { ok: true, txHash: 'h' })).toBe(e);
  });
  it('sucesso vira resultado confirmado do mesmo alvo e dados', () => {
    expect(atribuirResposta(emEnvio(), { ok: true, txHash: 'h' })).toMatchObject({ tipo: 'resultado', envio: { pedidoId: 'ped-1', amount: '139.6' }, resultado: { classe: 'confirmado' } });
  });
  it('VALOR_INVALIDO devolve aos Dados com o erro no campo e com o que foi digitado', () => {
    const e = atribuirResposta(emEnvio(), { ok: false, code: 'VALOR_INVALIDO', error: 'x' });
    expect(e).toMatchObject({ tipo: 'dados', dados: dadosOk, erros: { amount: expect.anything() } });
  });
  it('resposta sem código mantém o congelado (mesma chave e dados): reenviar seria o MESMO pedido', () => {
    const e = atribuirResposta(emEnvio(), { ok: false, error: 'erro interno' }) as Extract<Estado, { tipo: 'resultado' }>;
    expect(e).toMatchObject({ tipo: 'resultado', resultado: { classe: 'incerto' }, envio: { pedidoId: 'ped-1', amount: '139.6' } });
  });
  it('registro pendente: concluir registro reenvia os MESMOS cinco campos (mesma chave)', () => {
    const pend = atribuirResposta(emEnvio(), { ok: false, code: 'REGISTRO_PENDENTE', txHash: 'h', error: 'x' });
    const novo = concluirRegistro(pend, 'outra-chave-que-deve-ser-ignorada');
    expect(novo).toMatchObject({ tipo: 'envio', envio: { pedidoId: 'ped-1', amount: '139.6', investidorId: ALVO } });
  });
  it('concluir registro só existe em registro pendente; incerto não oferece reenvio', () => {
    const inc = atribuirResposta(emEnvio(), { ok: false, code: 'EXECUCAO_INCERTA', error: 'x' });
    expect(concluirRegistro(inc, 'k')).toBe(inc);
  });
  it('recusa definitiva: novo pedido volta aos Dados com os mesmos campos e atesto desmarcado; a chave antiga se perde', () => {
    const falhou = atribuirResposta(emEnvio(), { ok: false, code: 'EXECUCAO_FALHOU', error: 'x' });
    const novo = novoPedido(falhou);
    expect(novo).toMatchObject({ tipo: 'dados', dados: dadosOk });
    const env2 = confirmar(marcarAtesto(revisar(novo), true), 'ped-2');
    expect(env2).toMatchObject({ tipo: 'envio', envio: { pedidoId: 'ped-2' } });
  });
  it('novo pedido não existe depois de incerto', () => {
    const inc = atribuirResposta(emEnvio(), { ok: false, code: 'PEDIDO_EM_ANDAMENTO', error: 'x' });
    expect(novoPedido(inc)).toBe(inc);
  });
});

describe('fechar, reabrir e trocar de alvo', () => {
  it('fechar um resultado confirmado volta ao repouso; fechar incerto/registro pendente/envio só recolhe e conserva a tentativa', () => {
    const emEnvio = confirmar(ateRevisaoComAtesto(), 'ped-1');
    const inc = atribuirResposta(emEnvio, { ok: false, code: 'EXECUCAO_INCERTA', error: 'x' });
    const recolhido = fechar(inc);
    expect(recolhido).toMatchObject({ tipo: 'resultado', recolhido: true, envio: { pedidoId: 'ped-1' } });
    expect(reabrir(recolhido)).toMatchObject({ tipo: 'resultado', recolhido: false, envio: { pedidoId: 'ped-1' } });
    expect(fechar(emEnvio)).toMatchObject({ tipo: 'envio', recolhido: true });
    expect(fechar(atribuirResposta(emEnvio, { ok: true, txHash: 'h' }))).toMatchObject({ tipo: 'repouso' });
  });
  it('trocar de alvo: livre sem rascunho; com rascunho pede confirmação de descarte; tentativa enviada nunca é descartada pela troca', () => {
    expect(podeTrocarDeAlvo(estadoInicial(ALVO))).toBe('livre');
    expect(podeTrocarDeAlvo(preparar(estadoInicial(ALVO)))).toBe('livre'); // Dados vazio
    expect(podeTrocarDeAlvo(editar(preparar(estadoInicial(ALVO)), 'amount', '1'))).toBe('confirmar-descarte');
    expect(podeTrocarDeAlvo(ateRevisaoComAtesto())).toBe('confirmar-descarte');
    const env = confirmar(ateRevisaoComAtesto(), 'ped-1');
    expect(podeTrocarDeAlvo(env)).toBe('conserva-tentativa');
    expect(podeTrocarDeAlvo(atribuirResposta(env, { ok: false, error: 'erro interno' }))).toBe('conserva-tentativa');
    expect(podeTrocarDeAlvo(atribuirResposta(env, { ok: true, txHash: 'h' }))).toBe('livre');
  });
});
