/**
 * Microcopy do /sacar (Norma, `contexto/dapp-microcopy-entrar-sacar.md` §2).
 *
 * Só texto: nenhuma lógica. A página ainda NÃO usa este arquivo (o /sacar é do
 * E2-6 e está aberto; ligar depois). Regras do texto:
 * - "queima/burn/order/off-ramp/payout/settla/mock" ficam fora da tela (só nos
 *   "Detalhes técnicos", com rótulo claro);
 * - nunca dizer que o Pix foi recebido: a Plina só sabe o que a Etherfuse informa;
 * - "concluído" só com status `completed`; `processing` já é o terminal em
 *   sandbox e diz "em processamento". O status cru nunca aparece.
 */

export const SACAR = {
  eyebrow: 'Saque · TESOURO → reais (Pix)',
  banner:
    'Rede de testes · sem valor financeiro real · o Pix é simulado e não chega a conta bancária',
  carregando: 'Carregando…',
  login: {
    titulo: 'Entre para simular o saque do seu saldo em TESOURO, em reais, via Pix.',
    botao: 'Entrar',
  },
  erro: {
    sessao: 'Sua sessão expirou. Entre novamente.',
    fechar: 'Fechar',
    generico:
      'Não foi possível concluir. Tente novamente; se persistir, fale com a equipe em contato@plina.finance.',
  },
  cotacao: {
    titulo: 'Cotação do saque',
    valor: 'Valor a sacar, em TESOURO',
    resumo: 'Resumo da cotação',
    entrega: 'Você entrega',
    estimado: 'Valor estimado em reais',
    cambio: 'Cotação',
    taxa: 'Taxa',
    aviso:
      'Valores estimados. O valor final pode mudar se a cotação expirar. Rede de testes: nenhum dinheiro real é enviado.',
  },
  pedido: { botao: 'Solicitar saque', carregando: 'Registrando pedido…' },
  assinar: {
    titulo: 'Confirme o saque com sua assinatura',
    texto:
      'Seu pedido de saque foi registrado. Para continuar, você assina uma transação que retira o valor em TESOURO da sua carteira. Só depois da confirmação na rede o parceiro Etherfuse inicia o pagamento por Pix; antes disso, nada é enviado.',
    botao: 'Assinar e enviar',
    carregando: 'Assinando e enviando…',
  },
  detalhes: {
    resumo: 'Detalhes técnicos da operação',
    pedido: 'Pedido',
    situacao: 'Situação',
    tx: 'Transação na rede',
    simulado: ' · simulado',
  },
  aguardando: {
    titulo: 'Confirmando na rede…',
    texto:
      'Estamos aguardando a confirmação. Pode levar alguns instantes; esta página se atualiza sozinha.',
  },
  /** E2-6, provisório: confirmar com o contrato do E2-6 antes de usar. */
  passo: {
    resgate: 'Passo 1 de 2 · Resgatar seus tokens de demonstração em TESOURO',
    saque: 'Passo 2 de 2 · Sacar o TESOURO em reais (Pix simulado)',
  },
  resgate: {
    aviso:
      'O resgate usa o valor por token do pool, calculado pela Plina. Na operação real, o modelo prevê janelas periódicas de resgate, com limite por janela; o resgate pode ficar indisponível enquanto o valor por token estiver em conferência. Rede de testes, sem valor financeiro real.',
  },
} as const;

/**
 * Passo de resgate do E2-6 (tokens de demonstração → TESOURO). PROVISÓRIO: os
 * textos abaixo, exceto `passo`/`aviso` (Norma §2.7, também provisórios), são da
 * implementação e precisam da conferência da Norma/Consuelo. Sem "queima/burn".
 */
export const RESGATE = {
  eyebrow: 'Resgate · tokens de demonstração → TESOURO',
  quantidade: 'Quantidade de tokens a resgatar',
  maximo: 'Máx',
  gerar: 'Gerar cotação do resgate',
  gerando: 'Calculando…',
  entrega: 'Você entrega',
  valorPorToken: 'Valor por token',
  estimado: 'Valor estimado em TESOURO',
  avisoCotacao:
    'Valores estimados, calculados pela Plina. Se o valor por token mudar ou a cotação expirar, gere uma nova cotação. Rede de testes: nenhum dinheiro real é enviado.',
  validaAte: 'Cotação válida até',
  confirmar: 'Confirmar resgate',
  assinando: 'Assinando…',
  enviando: 'Enviando…',
  cancelar: 'Cancelar',
  erro: {
    nav_mudou: 'O valor por token mudou. Gere uma nova cotação para continuar.',
    cotacao_expirada: 'A cotação expirou. Gere uma nova cotação para continuar.',
    conflito: 'Esta cotação já foi usada em outro envio. Gere uma nova cotação para continuar.',
    indisponivel:
      'Resgate indisponível por enquanto. Tente novamente mais tarde.',
    em_conferencia:
      'Resgate indisponível por enquanto: o valor por token está em conferência. Tente novamente mais tarde.',
    generico:
      'Não foi possível concluir o resgate. Tente novamente; se persistir, fale com a equipe em contato@plina.finance.',
  },
  jaTemTesouro: 'Já tem TESOURO na carteira? Ir direto para o saque (Pix simulado) →',
  detalhesResumo: 'Detalhes técnicos',
  codigo: 'Código',
  concluido: {
    titulo: 'Resgate confirmado na rede de testes',
    texto:
      'A transação foi confirmada na rede. Rede de testes, sem valor financeiro real. O próximo passo é sacar o TESOURO em reais (Pix simulado).',
    tx: 'Transação na rede',
    proximo: 'Continuar para o saque →',
    novo: 'Novo resgate',
  },
} as const;

/** Situação da off-ramp → texto. O valor cru NUNCA aparece. */
const SITUACAO: Record<string, string> = {
  pending: 'Registrado',
  submitted: 'Registrado',
  processing: 'Em processamento',
  completed: 'Concluído',
  failed: 'Não concluído',
  cancelled: 'Cancelado',
  refunded: 'Devolvido',
};

export function situacaoSaque(status: string): string {
  return SITUACAO[status] ?? 'Em processamento';
}

export interface ResultadoSaque {
  titulo: string;
  texto: string;
}

const CONTATO = 'contato@plina.finance';
const AVISO_TESTNET = ' Rede de testes: nenhum dinheiro real envolvido.';

/**
 * Título e texto do resultado, um por situação. `completed` em produção é futuro
 * (⚖ validar com o jurídico antes de usar) e por isso exige `dataConclusao`.
 */
export function resultadoSaque(args: {
  status: string;
  simulado: boolean;
  pedido: string;
  dataConclusao?: string;
}): ResultadoSaque {
  const { status, simulado, pedido, dataConclusao } = args;
  switch (status) {
    case 'completed':
      if (simulado || !dataConclusao) {
        return {
          titulo: 'Saque concluído na simulação',
          texto: 'Simulação concluída. Nenhum dinheiro real foi enviado.',
        };
      }
      return {
        titulo: 'Saque concluído',
        texto: `A Etherfuse informou que o pagamento foi concluído em ${dataConclusao}. Confira em sua conta bancária; se não aparecer, fale com a equipe em ${CONTATO} informando o número do pedido.`,
      };
    case 'failed':
    case 'cancelled':
      return {
        titulo: status === 'failed' ? 'Saque não concluído' : 'Saque cancelado',
        texto: `O saque não foi concluído. O TESOURO já tinha sido entregue à Etherfuse; a devolução ou um novo envio segue o procedimento dela. Fale com a equipe em ${CONTATO} informando o número do pedido (${pedido}).${simulado ? AVISO_TESTNET : ''}`,
      };
    case 'refunded':
      return {
        titulo: 'Saque devolvido',
        texto: `A Etherfuse informou a devolução deste saque. Fale com a equipe em ${CONTATO} informando o número do pedido (${pedido}), para confirmar onde o valor foi creditado.${simulado ? AVISO_TESTNET : ''}`,
      };
    default:
      return {
        titulo: 'Saque em processamento',
        texto:
          'Sua assinatura foi confirmada na rede e o pedido está em processamento pela Etherfuse. Isto ainda não é o pagamento: ele só estará concluído quando a situação mudar para “Concluído”. Em rede de testes, o Pix é simulado e não chega a nenhuma conta.',
      };
  }
}
