/**
 * Máquina de estados do clawback no /admin (U1-11, spec da Íris `admin-clawback/SPEC.md`). Funções puras, sem UI e
 * sem texto: a tela (PRs seguintes) só liga eventos a estas funções e mostra o estado.
 *
 * Fluxo: repouso → Dados → Revisão → Envio → Resultado. Só `confirmar` (na Revisão, com atesto) leva a `envio`; o envio
 * congela os cinco campos que a action lê (investidorId, pedidoId, quantidade, motivo, URL) e a chave do pedido só muda
 * por escolha deliberada depois de uma RECUSA DEFINITIVA. Uma resposta sem código, desconhecida ou uma exceção é
 * resultado INCERTO e mantém a chave (falha de transporte não prova que nada foi executado).
 *
 * A carteira mostrada na Revisão (`carteiraRevisada`, opcional) é congelada com a tentativa e enviada como sexto campo: o servidor
 * recusa com CARTEIRA_DIVERGENTE, ANTES de qualquer tentativa, se a carteira mudou entre revisão e envio.
 *
 * A validação local repete a do servidor (`lib/services/tokenizacao.ts` e `liquidar/build`): a tela não decide limites.
 */

export const MOTIVOS = ['DECISAO_JUDICIAL', 'SANCAO_REGULATORIA', 'FRAUDE_DOCUMENTAL', 'ERRO_OPERACIONAL'] as const;
export type Motivo = (typeof MOTIVOS)[number];

export interface Dados {
  amount: string;
  motivo: Motivo | '';
  fundamentoUrl: string;
}
export type ErroCampo = 'vazio' | 'formato' | 'zero' | 'invalido';
export type ErrosDados = Partial<Record<keyof Dados, ErroCampo>>;

/** Os cinco campos da tentativa (o que `executarClawbackAction` lê do FormData). */
export interface Congelado {
  investidorId: string;
  pedidoId: string;
  amount: string;
  motivo: Motivo;
  fundamentoUrl: string;
  /** Carteira (chave pública) que o operador viu na Revisão; opcional por enquanto (trava de carteira no servidor). */
  carteiraRevisada?: string;
}

/**
 * Erros que o servidor devolve ANTES de gravar a tentativa e de qualquer envio: nada foi executado e a chave do pedido
 * não foi consumida (decisão do Argus: lista fechada). Os demais códigos NÃO renovam a chave sem uma escolha deliberada.
 */
export const ERROS_ANTES_DA_TENTATIVA = ['VALOR_INVALIDO', 'FUNDAMENTO_INVALIDO', 'PEDIDO_INVALIDO', 'CARTEIRA_DIVERGENTE'] as const;

/** Formato de `ActionResult` da action de clawback (só o que a máquina usa). */
export interface Retorno {
  ok: boolean;
  txHash?: string;
  idempotente?: boolean;
  code?: string;
  error?: string;
}

export type ClasseResultado =
  | 'confirmado'
  | 'ja_executado'
  | 'registro_pendente'
  | 'incerto'
  | 'falhou'
  | 'campo_invalido'
  | 'pedido_invalido'
  | 'carteira_divergente'
  | 'indisponivel';

export interface Resultado {
  classe: ClasseResultado;
  txHash?: string;
  /** Mensagem fixa do servidor, como veio (esta camada nunca a reescreve). */
  mensagem?: string;
  code?: string;
  /** Só em `campo_invalido`: o campo a corrigir em Dados. */
  campo?: 'amount' | 'fundamentoUrl';
  camposTravados: boolean;
  manterPedidoId: boolean;
  podeConcluirRegistro: boolean;
  podeNovoPedido: boolean;
}

export type Estado =
  | { tipo: 'repouso'; investidorId: string }
  | { tipo: 'dados'; investidorId: string; dados: Dados; erros: ErrosDados; aviso?: 'carteira_divergente' }
  | { tipo: 'revisao'; investidorId: string; dados: Dados; atesto: boolean; carteira?: string }
  | { tipo: 'envio'; investidorId: string; envio: Congelado; recolhido?: boolean }
  | { tipo: 'resultado'; investidorId: string; envio: Congelado; resultado: Resultado; recolhido?: boolean };

// ─── Validação local (espelho do servidor) ──────────────────────────────────

/** Mesmo regex do `liquidar/build`: decimal puro, até 12 inteiros e 7 casas (a Stellar tem 7). Sem notação científica. */
const FORMATO_QUANTIDADE = /^\d{1,12}(\.\d{1,7})?$/;

export function validarDados(d: Dados): ErrosDados {
  const erros: ErrosDados = {};
  if (d.amount === '') erros.amount = 'vazio';
  else if (!FORMATO_QUANTIDADE.test(d.amount)) erros.amount = 'formato';
  else if (!(Number(d.amount) > 0)) erros.amount = 'zero';

  if (d.motivo === '') erros.motivo = 'vazio';
  else if (!(MOTIVOS as readonly string[]).includes(d.motivo)) erros.motivo = 'invalido';

  const url = d.fundamentoUrl.trim();
  if (url === '') erros.fundamentoUrl = 'vazio';
  // Mesma regra do serviço: http(s) depois do trim (sem checar extensão nem validade jurídica do documento).
  else if (!/^https?:\/\//.test(url)) erros.fundamentoUrl = 'formato';
  return erros;
}

const vazio = (d: Dados) => d.amount === '' && d.motivo === '' && d.fundamentoUrl === '';

// ─── Transições ─────────────────────────────────────────────────────────────

export function estadoInicial(investidorId: string): Estado {
  return { tipo: 'repouso', investidorId };
}

/** "Preparar clawback": abre Dados vazio, sem valor nem motivo pré-selecionado. */
export function preparar(e: Estado): Estado {
  if (e.tipo !== 'repouso') return e;
  return { tipo: 'dados', investidorId: e.investidorId, dados: { amount: '', motivo: '', fundamentoUrl: '' }, erros: {} };
}

/** Só se edita em Dados; na Revisão, durante o envio e nos resultados nada muda (para alterar, `voltar`). */
export function editar<K extends keyof Dados>(e: Estado, campo: K, valor: Dados[K]): Estado {
  if (e.tipo !== 'dados') return e;
  const { [campo]: _tirado, ...restoErros } = e.erros;
  void _tirado;
  return { ...e, dados: { ...e.dados, [campo]: valor }, erros: restoErros };
}

/** Validação local, sem chamar o servidor. Com erro fica em Dados apontando os campos; sem erro vai à Revisão. */
export function revisar(e: Estado, carteira?: string): Estado {
  if (e.tipo !== 'dados') return e;
  const erros = validarDados(e.dados);
  if (Object.keys(erros).length > 0) return { ...e, erros };
  return {
    tipo: 'revisao',
    investidorId: e.investidorId,
    dados: { ...e.dados, fundamentoUrl: e.dados.fundamentoUrl.trim() },
    atesto: false,
    ...(carteira ? { carteira } : {}),
  };
}

export function marcarAtesto(e: Estado, atesto: boolean): Estado {
  if (e.tipo !== 'revisao') return e;
  return { ...e, atesto };
}

/** Da Revisão volta a Dados com o que foi digitado e o atesto desmarcado (qualquer alteração invalida a revisão). */
export function voltar(e: Estado): Estado {
  if (e.tipo !== 'revisao') return e;
  return { tipo: 'dados', investidorId: e.investidorId, dados: e.dados, erros: {} };
}

/** Descarta o rascunho (Dados ou Revisão) e volta ao repouso. Não existe depois do envio. */
export function cancelar(e: Estado): Estado {
  if (e.tipo !== 'dados' && e.tipo !== 'revisao') return e;
  return estadoInicial(e.investidorId);
}

/**
 * ÚNICO caminho para `envio`: Revisão com atesto. Congela os cinco campos (quantidade exatamente como digitada: "1.0"
 * não vira "1", pois o serviço compara a string guardada). Em `envio` é no-op: duplo clique não troca a chave.
 */
export function confirmar(e: Estado, pedidoId: string): Estado {
  if (e.tipo !== 'revisao' || !e.atesto) return e;
  return {
    tipo: 'envio',
    investidorId: e.investidorId,
    envio: {
      investidorId: e.investidorId,
      pedidoId,
      amount: e.dados.amount,
      motivo: e.dados.motivo as Motivo,
      fundamentoUrl: e.dados.fundamentoUrl,
      ...(e.carteira ? { carteiraRevisada: e.carteira } : {}),
    },
  };
}

/** FormData com os campos que `executarClawbackAction` lê: os cinco da tentativa e, se houver, `carteiraRevisada`. */
export function paraFormData(c: Congelado): FormData {
  const fd = new FormData();
  fd.set('investidorId', c.investidorId);
  fd.set('pedidoId', c.pedidoId);
  fd.set('amount', c.amount);
  fd.set('motivo', c.motivo);
  fd.set('fundamentoUrl', c.fundamentoUrl);
  if (c.carteiraRevisada) fd.set('carteiraRevisada', c.carteiraRevisada);
  return fd;
}

// ─── Retornos da action ─────────────────────────────────────────────────────

const r = (classe: ClasseResultado, extra: Partial<Resultado>): Resultado => ({
  classe,
  camposTravados: false,
  manterPedidoId: false,
  podeConcluirRegistro: false,
  podeNovoPedido: false,
  ...extra,
});

/** Tabela 6 da spec. Qualquer coisa fora da tabela (sem código, código novo, exceção, timeout) é INCERTO. */
export function classificarRetorno(ret: Retorno | null | undefined): Resultado {
  const incerto = (mensagem?: string, code?: string) => r('incerto', { camposTravados: true, manterPedidoId: true, mensagem, code });
  if (!ret || typeof ret !== 'object') return incerto();
  const mensagem = typeof ret.error === 'string' ? ret.error : undefined;
  if (ret.ok) {
    return ret.idempotente ? r('ja_executado', { txHash: ret.txHash }) : r('confirmado', { txHash: ret.txHash });
  }
  switch (ret.code) {
    case 'REGISTRO_PENDENTE':
      return r('registro_pendente', { txHash: ret.txHash, mensagem, code: ret.code, camposTravados: true, manterPedidoId: true, podeConcluirRegistro: true });
    case 'EXECUCAO_INCERTA':
    case 'PEDIDO_EM_ANDAMENTO':
      return incerto(mensagem, ret.code);
    case 'EXECUCAO_FALHOU':
    case 'PEDIDO_FALHOU':
      return r('falhou', { mensagem, code: ret.code, podeNovoPedido: true });
    case 'VALOR_INVALIDO':
      return r('campo_invalido', { mensagem, code: ret.code, campo: 'amount' });
    case 'FUNDAMENTO_INVALIDO':
      return r('campo_invalido', { mensagem, code: ret.code, campo: 'fundamentoUrl' });
    case 'PEDIDO_INVALIDO':
      // Antes da tentativa (Argus): nada foi executado; a chave pode ser renovada, só por novo pedido deliberado.
      return r('pedido_invalido', { mensagem, code: ret.code, podeNovoPedido: true });
    case 'CARTEIRA_DIVERGENTE':
      return r('carteira_divergente', { mensagem, code: ret.code });
    case 'INVESTIDOR_NAO_ENCONTRADO':
    case 'EMISSOR_NAO_CONFIGURADO':
      return r('indisponivel', { mensagem, code: ret.code, camposTravados: true, manterPedidoId: true });
    default:
      return incerto(mensagem, ret.code);
  }
}

/** Aplica a resposta a um envio em andamento. Em qualquer outro estado não faz nada. */
export function atribuirResposta(e: Estado, retorno: Retorno | null | undefined): Estado {
  if (e.tipo !== 'envio') return e;
  const resultado = classificarRetorno(retorno);
  if (resultado.classe === 'campo_invalido' && resultado.campo) {
    // Nada foi executado: volta aos Dados, com o que foi digitado e o erro no campo.
    const { amount, motivo, fundamentoUrl } = e.envio;
    return { tipo: 'dados', investidorId: e.investidorId, dados: { amount, motivo, fundamentoUrl }, erros: { [resultado.campo]: 'invalido' } };
  }
  if (resultado.classe === 'carteira_divergente') {
    // Nada foi executado nem a chave consumida: volta aos Dados; a carteira revisada antiga NÃO se reaproveita (nova revisão).
    const { amount, motivo, fundamentoUrl } = e.envio;
    return { tipo: 'dados', investidorId: e.investidorId, dados: { amount, motivo, fundamentoUrl }, erros: {}, aviso: 'carteira_divergente' };
  }
  return { tipo: 'resultado', investidorId: e.investidorId, envio: e.envio, resultado, recolhido: e.recolhido };
}

/**
 * "Concluir registro": reenvia os MESMOS cinco campos (mesma chave) depois de REGISTRO_PENDENTE. O segundo argumento
 * existe só para deixar explícito que uma chave nova nunca é usada aqui.
 */
export function concluirRegistro(e: Estado, _chaveQueSeraIgnorada?: string): Estado {
  void _chaveQueSeraIgnorada;
  if (e.tipo !== 'resultado' || !e.resultado.podeConcluirRegistro) return e;
  return { tipo: 'envio', investidorId: e.investidorId, envio: e.envio, recolhido: false };
}

/** Depois de recusa DEFINITIVA, nova tentativa deliberada: volta a Dados com os mesmos campos e perde a chave antiga. */
export function novoPedido(e: Estado): Estado {
  if (e.tipo !== 'resultado' || !e.resultado.podeNovoPedido) return e;
  const { amount, motivo, fundamentoUrl } = e.envio;
  return { tipo: 'dados', investidorId: e.investidorId, dados: { amount, motivo, fundamentoUrl }, erros: {} };
}

// ─── Fechar, reabrir, trocar de alvo ────────────────────────────────────────

/** Resultado confirmado/já executado: fecha o fluxo. Envio, incerto e registro pendente só recolhem a vista e conservam a tentativa. */
export function fechar(e: Estado): Estado {
  if (e.tipo === 'envio') return { ...e, recolhido: true };
  if (e.tipo === 'resultado') {
    if (e.resultado.classe === 'confirmado' || e.resultado.classe === 'ja_executado') return estadoInicial(e.investidorId);
    return { ...e, recolhido: true };
  }
  return e;
}

export function reabrir(e: Estado): Estado {
  if (e.tipo === 'envio' || e.tipo === 'resultado') return { ...e, recolhido: false };
  return e;
}

/**
 * Trocar de investidor: livre se não há nada a perder; com rascunho pede confirmação de descarte (nunca leva
 * quantidade/motivo/URL para outro alvo em silêncio); uma tentativa já enviada nunca é descartada pela troca.
 */
export function podeTrocarDeAlvo(e: Estado): 'livre' | 'confirmar-descarte' | 'conserva-tentativa' {
  switch (e.tipo) {
    case 'repouso':
      return 'livre';
    case 'dados':
      return vazio(e.dados) ? 'livre' : 'confirmar-descarte';
    case 'revisao':
      return 'confirmar-descarte';
    case 'envio':
      return 'conserva-tentativa';
    case 'resultado':
      return e.resultado.classe === 'confirmado' || e.resultado.classe === 'ja_executado' ? 'livre' : 'conserva-tentativa';
  }
}
