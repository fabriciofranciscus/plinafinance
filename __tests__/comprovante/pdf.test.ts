import { describe, it, expect } from 'vitest';
import { buildComprovantePdf } from '@/lib/comprovante/pdf';

describe('buildComprovantePdf', () => {
  it('gera um Buffer PDF válido', async () => {
    const buf = await buildComprovantePdf({
      cessaoId: 'cssao_123',
      valorLiquido: 'R$ 80.500,00',
      desagioPct: '19,50%',
      administradora: 'Embracon Consórcios',
      tipoBem: 'VEICULO',
      hashDocumento: 'a'.repeat(64),
      cessaoTxHash: 'tx_cessao',
      pixTxHash: 'tx_pix',
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
