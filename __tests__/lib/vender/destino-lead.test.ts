import { describe, expect, it } from 'vitest';
import { destinoAposEnvio } from '@/lib/vender/destino-lead';

describe('destinoAposEnvio (A-11)', () => {
  it('solicitação nova: vai ao acompanhamento sem aviso', () => {
    expect(destinoAposEnvio({ leadId: 'abc', reaproveitada: false, statusAtual: 'NOVO' })).toBe('/vender/acompanhar/abc');
    expect(destinoAposEnvio({ leadId: 'abc' })).toBe('/vender/acompanhar/abc');
  });
  it('reaproveitada e aberta: mesmo id, com aviso', () => {
    expect(destinoAposEnvio({ leadId: 'abc', reaproveitada: true, statusAtual: 'OFERTA_ENVIADA' })).toBe('/vender/acompanhar/abc?aviso=reaproveitada');
  });
  it('reaproveitada mas encerrada (PERDIDO): sem "abrimos a mesma"; a página já diz que foi encerrada', () => {
    expect(destinoAposEnvio({ leadId: 'abc', reaproveitada: true, statusAtual: 'PERDIDO' })).toBe('/vender/acompanhar/abc');
  });
});
