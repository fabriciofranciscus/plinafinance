import { describe, expect, it } from 'vitest';
import { RESGATE, SACAR, erroResgate, resultadoSaque, situacaoSaque } from '@/lib/sacar/microcopy';

function textos(o: unknown): string[] {
  if (typeof o === 'string') return [o];
  if (o && typeof o === 'object') return Object.values(o).flatMap(textos);
  return [];
}

describe('microcopy do /sacar (Norma)', () => {
  it('o status cru nunca aparece: todo status vira texto; desconhecido vira "Em processamento"', () => {
    expect(situacaoSaque('pending')).toBe('Registrado');
    expect(situacaoSaque('submitted')).toBe('Registrado');
    expect(situacaoSaque('processing')).toBe('Em processamento');
    expect(situacaoSaque('completed')).toBe('Concluído');
    expect(situacaoSaque('failed')).toBe('Não concluído');
    expect(situacaoSaque('cancelled')).toBe('Cancelado');
    expect(situacaoSaque('refunded')).toBe('Devolvido');
    expect(situacaoSaque('algo_novo')).toBe('Em processamento');
  });

  it('só diz "concluído" com completed; processing é "em processamento"', () => {
    const proc = resultadoSaque({ status: 'processing', simulado: true, pedido: 'o1' });
    expect(proc.titulo).toBe('Saque em processamento');
    expect(proc.texto).toMatch(/Isto ainda não é o pagamento/);
    for (const st of ['processing', 'pending', 'failed', 'cancelled', 'refunded']) {
      expect(resultadoSaque({ status: st, simulado: true, pedido: 'o1' }).titulo).not.toMatch(/^Saque conclu/);
    }
    expect(resultadoSaque({ status: 'completed', simulado: true, pedido: 'o1' }).titulo).toBe('Saque concluído na simulação');
  });

  it('completed em produção exige a data e fala "a Etherfuse informou", nunca "você recebeu"', () => {
    const r = resultadoSaque({ status: 'completed', simulado: false, pedido: 'o1', dataConclusao: '11/11/2026' });
    expect(r.titulo).toBe('Saque concluído');
    expect(r.texto).toMatch(/A Etherfuse informou/);
    expect(r.texto).not.toMatch(/você recebeu/i);
    // sem data cai na simulação (não inventa conclusão)
    expect(resultadoSaque({ status: 'completed', simulado: false, pedido: 'o1' }).titulo).toBe('Saque concluído na simulação');
  });

  it('falha, cancelamento e devolução trazem o número do pedido e o contato, sem prometer devolução nem prazo', () => {
    for (const st of ['failed', 'cancelled', 'refunded']) {
      const r = resultadoSaque({ status: st, simulado: true, pedido: 'ped-123' });
      expect(r.texto).toContain('ped-123');
      expect(r.texto).toContain('contato@plina.finance');
      expect(r.texto).not.toMatch(/em até|minutos|garant/i);
    }
  });

  it('em rede de testes, falha/cancelamento/devolução fecham com o aviso de que nenhum dinheiro real está envolvido (Consuelo)', () => {
    for (const st of ['failed', 'cancelled', 'refunded']) {
      expect(resultadoSaque({ status: st, simulado: true, pedido: 'p' }).texto).toMatch(
        /Rede de testes: nenhum dinheiro real envolvido\.$/,
      );
      expect(resultadoSaque({ status: st, simulado: false, pedido: 'p' }).texto).not.toMatch(/Rede de testes/);
    }
  });

  it('nenhum texto usa jargão ou promessa proibida pela Norma', () => {
    const todos = [
      ...textos(SACAR),
      ...['processing', 'completed', 'failed', 'cancelled', 'refunded'].flatMap((st) =>
        textos(resultadoSaque({ status: st, simulado: true, pedido: 'p' })),
      ),
    ].join(' ');
    expect(todos).not.toMatch(/\b(burn|queima|order|off-ramp|payout|settla|mock|receberá|institucional|lastr|FIDC|yield)\b/i);
    expect(todos).not.toMatch(/\b48h\b|minutos|à vista/i);
  });
});

describe('microcopy do resgate (E2-6): erros da Norma §2.8–2.9', () => {
  const TIPOS = ['nav_mudou', 'cotacao_expirada', 'conflito', 'sem_liquidez', 'em_conferencia', 'indisponivel', 'classe_indisponivel', 'rede_nao_confirmou', 'rede_recusou', 'preco_fora_da_faixa', 'acima_do_teto', 'generico'] as const;

  it('sem liquidez: build e submit têm textos próprios, sem prometer prazo nem janela', () => {
    const b = erroResgate('sem_liquidez', 'build');
    expect(b.titulo).toBe('Resgate indisponível para este valor');
    expect(b.texto).toBe(
      'No momento não há liquidez disponível para este valor. Tente um valor menor ou fale com a equipe em contato@plina.finance. Rede de testes, sem valor financeiro real.',
    );
    expect(erroResgate('sem_liquidez', 'submit').texto).toBe(
      'A disponibilidade mudou desde a cotação. Nada foi enviado à rede e a assinatura que você fez não será usada. Tente de novo com um valor menor.',
    );
    expect(RESGATE.acaoSemLiquidez).toBe('Tentar outro valor');
  });

  it('em conferência cita o número do pedido quando existe e omite a frase quando não existe', () => {
    expect(erroResgate('em_conferencia', 'submit', 'q-123').texto).toContain('informando o número do pedido (q-123)');
    expect(erroResgate('em_conferencia', 'build').texto).not.toMatch(/número do pedido/);
    expect(erroResgate('em_conferencia', 'build').texto).toMatch(/Não há prazo definido\./);
  });

  it('LEDGER_UNAVAILABLE e CLASSE_INDISPONIVEL têm textos distintos; nav/expirada dizem "Nada foi enviado"', () => {
    expect(erroResgate('indisponivel', 'build').titulo).toBe('Resgate indisponível no momento');
    expect(erroResgate('classe_indisponivel', 'build').titulo).toBe('Resgate indisponível para esta subclasse');
    expect(erroResgate('nav_mudou', 'submit').texto).toMatch(/Nada foi enviado/);
    expect(erroResgate('cotacao_expirada', 'submit').texto).toMatch(/Nada foi enviado/);
  });

  it('502: "não confirmou, estamos conferindo", nunca "não foram resgatados"; genérico e conflito mandam conferir antes de tentar de novo', () => {
    const r = erroResgate('rede_nao_confirmou', 'submit', 'q-9');
    expect(r.titulo).toBe('A rede não confirmou o resgate');
    expect(r.texto).toMatch(/Estamos conferindo automaticamente\. Não repita o resgate agora/);
    expect(r.texto).toMatch(/Consulte sua posição mais tarde/);
    expect(r.texto).toContain('número do pedido (q-9)');
    for (const t of ['rede_nao_confirmou', 'generico', 'conflito'] as const) {
      expect(erroResgate(t, 'submit', 'q-9').texto).not.toMatch(/não foram resgatados|gere uma nova cotação|tente novamente;/i);
    }
    expect(erroResgate('generico', 'build').texto).toMatch(/Confira seu saldo antes de tentar de novo/);
    expect(erroResgate('generico', 'build').texto).toMatch(/número do pedido, se houver/);
    expect(erroResgate('conflito', 'submit', 'q-9').texto).toMatch(/Confira seu histórico antes de pedir um novo resgate/);
  });

  it('preço fora da faixa e teto (Norma §2.9): textos exatos, assinatura só no submit, sem limite, ±2%, referência nem causa', () => {
    const pb = erroResgate('preco_fora_da_faixa', 'build');
    expect(pb.titulo).toBe('Não foi possível validar o preço agora');
    expect(pb.texto).toBe('Não conseguimos validar o preço deste resgate neste momento. Nada foi enviado. Tente de novo mais tarde ou fale com a equipe em contato@plina.finance.');
    expect(erroResgate('preco_fora_da_faixa', 'submit').texto).toBe('Não conseguimos validar o preço deste resgate neste momento. Nada foi enviado. A assinatura que você fez não será usada. Tente de novo mais tarde ou fale com a equipe em contato@plina.finance.');
    const tb = erroResgate('acima_do_teto', 'build');
    expect(tb.titulo).toBe('Valor acima do limite por resgate');
    expect(tb.texto).toBe('Este valor está acima do limite por resgate. Nada foi enviado. Tente um valor menor ou fale com a equipe em contato@plina.finance.');
    expect(erroResgate('acima_do_teto', 'submit').texto).toContain('A assinatura que você fez não será usada.');
    for (const t of ['preco_fora_da_faixa', 'acima_do_teto'] as const) {
      for (const fase of ['build', 'submit'] as const) {
        const x = erroResgate(t, fase).texto;
        expect(x).not.toMatch(/\d|±|referência|mercado|manipula|janela|R\$/i);
        if (fase === 'build') expect(x).not.toMatch(/assinatura/);
      }
    }
  });

  it('502 separado (Norma §2.9 final): "recusou" só diz não resgatados; "não confirmou" fecha com "Não há prazo definido."', () => {
    const rec = erroResgate('rede_recusou', 'submit', 'q-1');
    expect(rec.titulo).toBe('A rede recusou o resgate');
    expect(rec.texto).toBe('A rede de testes não aceitou este resgate, e seus tokens de demonstração não foram resgatados. Você pode tentar de novo.');
    expect(erroResgate('rede_nao_confirmou', 'submit', 'q-1').texto).toMatch(/Não há prazo definido\.$/);
    // 504 (Norma §2.9): orienta a NÃO repetir e a consultar a posição
    const inc = erroResgate('rede_nao_confirmou', 'submit', 'q-1');
    expect(inc.texto).toBe('Não conseguimos confirmar o resultado na rede de testes. Estamos conferindo automaticamente. Não repita o resgate agora: um novo pedido ficaria em conferência. Consulte sua posição mais tarde; seus tokens de demonstração só saem se a rede confirmar. Se demorar, fale conosco em contato@plina.finance informando o número do pedido (q-1). Não há prazo definido.');
    expect(RESGATE.verPosicao).toBe('Ver minha posição');
    expect(erroResgate('rede_nao_confirmou', 'submit', 'q-1').texto).not.toMatch(/não foram resgatados/);
  });

  it('nenhum texto usa jargão, código cru, prazo ou janela', () => {
    for (const t of TIPOS) {
      for (const fase of ['build', 'submit'] as const) {
        const { titulo, texto } = erroResgate(t, fase, 'p-1');
        expect(`${titulo} ${texto}`).not.toMatch(/\b(burn|queima|order|result_codes|LEDGER_|CLASSE_|NAV_MUDOU|janela|minutos|48h)\b/i);
        expect(texto.length).toBeGreaterThan(20);
      }
    }
  });
});
