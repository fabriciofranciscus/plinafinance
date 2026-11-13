import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ sendMail: vi.fn(), transporter: vi.fn() }));
vi.mock('@/lib/email/transporter', () => ({
  getIncidentTransporter: m.transporter,
  incidentFromAddress: () => 'help@exemplo.test',
}));

import { enviarAlertaOps } from '@/lib/services/alerta-ops';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.sendMail.mockReset().mockResolvedValue({});
  m.transporter.mockReset().mockReturnValue({ sendMail: m.sendMail });
  delete process.env.INCIDENT_EMAIL_TO;
});

describe('enviarAlertaOps', () => {
  it('envia pela caixa de incidentes, para INCIDENT_EMAIL_TO ou help@plina.finance', async () => {
    expect(await enviarAlertaOps({ assunto: 'x', linhas: ['a', 'b'] })).toBe(true);
    expect(m.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'help@plina.finance', subject: '[Plina · ALERTA] x', text: 'a\nb' }),
    );
    process.env.INCIDENT_EMAIL_TO = 'ops@exemplo.test';
    await enviarAlertaOps({ assunto: 'y', linhas: [] });
    expect(m.sendMail.mock.calls[1][0].to).toBe('ops@exemplo.test');
  });

  it('sem SMTP configurado: no-op (false), sem lançar', async () => {
    m.transporter.mockReturnValue(null);
    expect(await enviarAlertaOps({ assunto: 'x', linhas: [] })).toBe(false);
    expect(m.sendMail).not.toHaveBeenCalled();
  });

  it('falha do envio: false e o log leva só o nome do erro (sem destinatário nem mensagem)', async () => {
    m.sendMail.mockRejectedValue(Object.assign(new Error('rejected ops@exemplo.test'), { name: 'SmtpError' }));
    expect(await enviarAlertaOps({ assunto: 'x', linhas: [] })).toBe(false);
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain('exemplo.test');
  });
});
