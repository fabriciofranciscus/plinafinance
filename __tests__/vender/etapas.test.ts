import { describe, it, expect } from 'vitest';
import { LeadVendedorStatus } from '@prisma/client';
import {
  etapaDoStatus,
  isEncerrado,
  contextoDoStatus,
  ETAPAS_VENDER,
} from '@/lib/vender/etapas';

describe('etapaDoStatus', () => {
  it('mapeia status → índice de etapa (lead já passou de Cadastro/Envio)', () => {
    // Cadastro & KYC (0) e Envio da cota (1) já estão concluídos quando há lead.
    expect(etapaDoStatus(LeadVendedorStatus.NOVO)).toBe(2);
    expect(etapaDoStatus(LeadVendedorStatus.CONTATADO)).toBe(2);
    expect(etapaDoStatus(LeadVendedorStatus.DOCS_SOLICITADOS)).toBe(2);
    expect(etapaDoStatus(LeadVendedorStatus.DOCS_RECEBIDOS)).toBe(3);
    expect(etapaDoStatus(LeadVendedorStatus.OFERTA_ENVIADA)).toBe(3);
    expect(etapaDoStatus(LeadVendedorStatus.OFERTA_ACEITA)).toBe(4);
    expect(etapaDoStatus(LeadVendedorStatus.CESSAO_ASSINADA)).toBe(5);
  });

  it('nenhum status volta para Cadastro & KYC (0) ou Envio da cota (1)', () => {
    for (const status of Object.values(LeadVendedorStatus)) {
      if (status === LeadVendedorStatus.PERDIDO) continue;
      expect(etapaDoStatus(status)).toBeGreaterThanOrEqual(2);
    }
  });

  it('PERDIDO é terminal (-1) e encerrado', () => {
    expect(etapaDoStatus(LeadVendedorStatus.PERDIDO)).toBe(-1);
    expect(isEncerrado(LeadVendedorStatus.PERDIDO)).toBe(true);
    expect(isEncerrado(LeadVendedorStatus.NOVO)).toBe(false);
  });

  it('todo status tem contexto com título e descrição (nunca em branco)', () => {
    for (const status of Object.values(LeadVendedorStatus)) {
      const ctx = contextoDoStatus(status);
      expect(ctx.titulo.length).toBeGreaterThan(0);
      expect(ctx.descricao.length).toBeGreaterThan(0);
    }
  });

  it('fluxo concluído marca todas as etapas como feitas (current = length)', () => {
    expect(etapaDoStatus(LeadVendedorStatus.PIX_EXECUTADO)).toBe(
      ETAPAS_VENDER.length,
    );
    expect(etapaDoStatus(LeadVendedorStatus.COTA_INCORPORADA)).toBe(
      ETAPAS_VENDER.length,
    );
  });
});
