import { describe, it, expect } from 'vitest';
import { renderIncidentEmail } from '@/lib/email/templates-incident';

const base = {
  nome: 'Maria Investidora',
  email: 'maria@fund.com',
  ticketId: 'INC-AB12-CD34',
  technical: 'op_no_trust ao submeter swap',
  recebido: '2026-06-10T12:00:00.000Z',
};

describe('renderIncidentEmail', () => {
  it('usa o ticketId no subject', () => {
    const { subject } = renderIncidentEmail(base);
    expect(subject).toBe('[Incidente] INC-AB12-CD34');
  });

  it('inclui nome, e-mail e mensagem técnica no corpo (text e html)', () => {
    const { text, html } = renderIncidentEmail(base);
    for (const out of [text, html]) {
      expect(out).toContain('Maria Investidora');
      expect(out).toContain('maria@fund.com');
      expect(out).toContain('INC-AB12-CD34');
      expect(out).toContain('op_no_trust');
    }
  });

  it('inclui a mensagem livre do usuário quando presente', () => {
    const { text, html } = renderIncidentEmail({
      ...base,
      mensagem: 'Travou após o PIX',
    });
    expect(text).toContain('Travou após o PIX');
    expect(html).toContain('Travou após o PIX');
  });

  it('marca "(nenhuma)" quando não há mensagem', () => {
    const { text, html } = renderIncidentEmail({ ...base, mensagem: '' });
    expect(text).toContain('(nenhuma)');
    expect(html).toContain('(nenhuma)');
  });

  it('escapa HTML do conteúdo dinâmico para evitar injeção', () => {
    const { html } = renderIncidentEmail({
      ...base,
      mensagem: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('cai para "—" em rota/user-agent ausentes', () => {
    const { text } = renderIncidentEmail(base);
    expect(text).toContain('Rota:       —');
    expect(text).toContain('User-agent: —');
  });
});
