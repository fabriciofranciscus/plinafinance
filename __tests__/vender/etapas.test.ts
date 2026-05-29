import { describe, it, expect } from 'vitest';
import { LeadVendedorStatus } from '@prisma/client';
import {
  etapaDoStatus,
  isEncerrado,
  ETAPAS_VENDER,
} from '@/lib/vender/etapas';

describe('etapaDoStatus', () => {
  it('mapeia status → índice de etapa', () => {
    expect(etapaDoStatus(LeadVendedorStatus.NOVO)).toBe(0);
    expect(etapaDoStatus(LeadVendedorStatus.DOCS_RECEBIDOS)).toBe(1);
    expect(etapaDoStatus(LeadVendedorStatus.OFERTA_ENVIADA)).toBe(2);
    expect(etapaDoStatus(LeadVendedorStatus.OFERTA_ACEITA)).toBe(2);
    expect(etapaDoStatus(LeadVendedorStatus.CESSAO_ASSINADA)).toBe(3);
    expect(etapaDoStatus(LeadVendedorStatus.PIX_EXECUTADO)).toBe(4);
    expect(etapaDoStatus(LeadVendedorStatus.COTA_INCORPORADA)).toBe(5);
  });

  it('PERDIDO é terminal (-1) e encerrado', () => {
    expect(etapaDoStatus(LeadVendedorStatus.PERDIDO)).toBe(-1);
    expect(isEncerrado(LeadVendedorStatus.PERDIDO)).toBe(true);
    expect(isEncerrado(LeadVendedorStatus.NOVO)).toBe(false);
  });

  it('índices da etapa final cabem na lista', () => {
    expect(etapaDoStatus(LeadVendedorStatus.COTA_INCORPORADA)).toBe(
      ETAPAS_VENDER.length - 1,
    );
  });
});
