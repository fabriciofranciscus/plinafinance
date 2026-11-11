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
const EQUIPE = 'contato@plina.finance';

export type ResgateErroTipoTexto =
  | 'nav_mudou'
  | 'cotacao_expirada'
  | 'conflito'
  | 'sem_liquidez'
  | 'em_conferencia'
  | 'indisponivel'
  | 'classe_indisponivel'
  | 'rede_nao_confirmou'
  | 'rede_recusou'
  | 'preco_fora_da_faixa'
  | 'acima_do_teto'
  | 'generico';

/**
 * Título e texto de cada erro do resgate (Norma §2.8–2.9). `pedido` é o número do
 * pedido (quoteId da cotação) quando existe; sem ele a frase do número sai.
 * O código cru nunca aparece aqui (só em "Detalhes técnicos").
 */
export function erroResgate(
  tipo: ResgateErroTipoTexto,
  fase: 'build' | 'submit',
  pedido?: string | null,
): { titulo: string; texto: string } {
  // no submit o investidor já assinou o envelope; no build não há assinatura
  const assinatura = fase === 'submit' ? ' A assinatura que você fez não será usada.' : '';
  const numero = pedido ? ` informando o número do pedido (${pedido})` : '';
  switch (tipo) {
    case 'sem_liquidez':
      return {
        titulo: 'Resgate indisponível para este valor',
        texto:
          fase === 'submit'
            ? 'A disponibilidade mudou desde a cotação. Nada foi enviado à rede e a assinatura que você fez não será usada. Tente de novo com um valor menor.'
            : `No momento não há liquidez disponível para este valor. Tente um valor menor ou fale com a equipe em ${EQUIPE}. Rede de testes, sem valor financeiro real.`,
      };
    case 'em_conferencia':
      return {
        titulo: 'Há um resgate seu em conferência',
        texto: `Não é possível iniciar outro resgate agora, porque o anterior ainda está em conferência. Nossa equipe verifica o pedido. Se demorar, fale conosco em ${EQUIPE}${numero}. Não há prazo definido.`,
      };
    case 'nav_mudou':
      return {
        titulo: 'O valor por token mudou',
        texto: 'O valor por token foi atualizado desde a cotação. Nada foi enviado. Veja o novo valor e confirme de novo.',
      };
    case 'cotacao_expirada':
      return {
        titulo: 'A cotação expirou',
        texto: 'O tempo desta cotação acabou. Nada foi enviado. Peça uma nova cotação para continuar.',
      };
    case 'indisponivel':
      return {
        titulo: 'Resgate indisponível no momento',
        texto: `Não conseguimos calcular o valor por token agora. Nada foi enviado. Tente de novo mais tarde ou fale com a equipe em ${EQUIPE}.`,
      };
    case 'classe_indisponivel':
      return {
        titulo: 'Resgate indisponível para esta subclasse',
        texto: 'O resgate desta subclasse ainda não está disponível na rede de testes.',
      };
    // Norma §2.9 (409 no build e no submit de reserva nova). Sem número do limite, sem ±2%/referência, sem causa.
    case 'preco_fora_da_faixa':
      return {
        titulo: 'Não foi possível validar o preço agora',
        texto: `Não conseguimos validar o preço deste resgate neste momento. Nada foi enviado.${assinatura} Tente de novo mais tarde ou fale com a equipe em ${EQUIPE}.`,
      };
    case 'acima_do_teto':
      return {
        titulo: 'Valor acima do limite por resgate',
        texto: `Este valor está acima do limite por resgate. Nada foi enviado.${assinatura} Tente um valor menor ou fale com a equipe em ${EQUIPE}.`,
      };
    case 'rede_nao_confirmou':
      // Caso ambíguo (STELLAR_SUBMIT_INCERTO, ou 502 enquanto cobrir os dois): a tx pode ter entrado.
      // NÃO dizer "não foram resgatados".
      return {
        titulo: 'A rede não confirmou o resgate',
        texto: `A rede de testes não confirmou este resgate e estamos conferindo. Seus tokens de demonstração só saem se a rede confirmar. Antes de tentar de novo, confira seu saldo. Se você iniciar outro resgate agora, pode aparecer que há um resgate em conferência; fale conosco em ${EQUIPE}${numero}. Não há prazo definido.`,
      };
    case 'rede_recusou':
      // SÓ com o código novo do Bento (STELLAR_SUBMIT_FAILED separado de INCERTO): rejeição real, reserva liberada.
      return {
        titulo: 'A rede recusou o resgate',
        texto: 'A rede de testes não aceitou este resgate, e seus tokens de demonstração não foram resgatados. Você pode tentar de novo.',
      };
    case 'conflito':
      return {
        titulo: 'Cotação já usada',
        texto: `Esta cotação já foi usada em um envio. Confira seu histórico antes de pedir um novo resgate; em caso de dúvida, fale com a equipe${numero}.`,
      };
    default:
      return {
        titulo: 'Não foi possível confirmar o resgate agora',
        texto: `Não foi possível confirmar o resgate agora. Confira seu saldo antes de tentar de novo. Se persistir, fale com a equipe em ${EQUIPE}${pedido ? ` informando o número do pedido (${pedido})` : ', informando o número do pedido, se houver'}.`,
      };
  }
}

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
  /** Rótulos de erro do resgate: ver `erroResgate`. Norma §2.8–2.9; o 502 aguarda o Bento. */
  acaoSemLiquidez: 'Tentar outro valor',
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
