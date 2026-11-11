import { describe, expect, it } from 'vitest';
import { SACAR, resultadoSaque, situacaoSaque } from '@/lib/sacar/microcopy';

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

describe('microcopy do resgate (E2-6)', () => {
  it('sem liquidez: texto do Atlas, sem prometer prazo; todo erro tem mensagem', async () => {
    const { RESGATE } = await import('@/lib/sacar/microcopy');
    expect(RESGATE.erro.sem_liquidez).toBe(
      'No momento não há liquidez disponível para este valor. Tente um valor menor ou fale com o time.',
    );
    for (const t of ['nav_mudou', 'cotacao_expirada', 'conflito', 'sem_liquidez', 'em_conferencia', 'indisponivel', 'generico'] as const) {
      expect(RESGATE.erro[t].length).toBeGreaterThan(10);
      expect(RESGATE.erro[t]).not.toMatch(/\b(burn|queima|em até|minutos|48h)\b/i);
    }
  });
});
