import { describe, it, expect } from 'vitest';
import {
  ticketMinimoFor,
  tipoFromAnswers,
  TICKET_MINIMO_BRL,
} from '@/lib/config/suitability';

describe('lib/config/suitability', () => {
  describe('ticketMinimoFor', () => {
    it('QUALIFICADO → R$ 500k', () => {
      expect(ticketMinimoFor('INST_BR_QUALIFICADO')).toBe(500_000);
    });
    it('PROFISSIONAL → R$ 1M', () => {
      expect(ticketMinimoFor('INST_BR_PROFISSIONAL')).toBe(1_000_000);
    });
    it('null/undefined → 0 (sem enforcement)', () => {
      expect(ticketMinimoFor(null)).toBe(0);
      expect(ticketMinimoFor(undefined)).toBe(0);
    });
    it('expõe a tabela canônica para inspeção', () => {
      expect(TICKET_MINIMO_BRL.INST_BR_QUALIFICADO).toBe(500_000);
    });
  });

  describe('tipoFromAnswers', () => {
    it('AUM ≥ R$ 10M + arrojado + avançado → PROFISSIONAL', () => {
      expect(
        tipoFromAnswers({
          perfil: 'ARROJADO',
          experiencia: 'AVANCADA',
          aumBrl: '10000000.00',
          cienteRisco: true,
        }),
      ).toBe('INST_BR_PROFISSIONAL');
    });

    it('AUM abaixo de R$ 10M → QUALIFICADO mesmo com perfil arrojado/avançado', () => {
      expect(
        tipoFromAnswers({
          perfil: 'ARROJADO',
          experiencia: 'AVANCADA',
          aumBrl: '9999999.99',
          cienteRisco: true,
        }),
      ).toBe('INST_BR_QUALIFICADO');
    });

    it('perfil conservador → QUALIFICADO independente de AUM/experiência', () => {
      expect(
        tipoFromAnswers({
          perfil: 'CONSERVADOR',
          experiencia: 'AVANCADA',
          aumBrl: '50000000.00',
          cienteRisco: true,
        }),
      ).toBe('INST_BR_QUALIFICADO');
    });

    it('experiência intermediária → QUALIFICADO mesmo com AUM e perfil altos', () => {
      expect(
        tipoFromAnswers({
          perfil: 'ARROJADO',
          experiencia: 'INTERMEDIARIA',
          aumBrl: '50000000.00',
          cienteRisco: true,
        }),
      ).toBe('INST_BR_QUALIFICADO');
    });
  });
});
