import { describe, it, expect } from 'vitest';
import {
  taxaAnuenciaBpsFor,
  DEFAULT_TAXA_ANUENCIA_BPS,
} from '@/lib/config/administradoras';

describe('taxaAnuenciaBpsFor', () => {
  it('reconhece marca com sufixo e acento', () => {
    expect(taxaAnuenciaBpsFor('Embracon Consórcios')).toBe(150);
    expect(taxaAnuenciaBpsFor('Porto Real Consórcios')).toBe(200);
    expect(taxaAnuenciaBpsFor('Bradesco Consórcios')).toBe(180);
    expect(taxaAnuenciaBpsFor('Caixa Consórcios Demo')).toBe(220);
  });

  it('desconhecida → default', () => {
    expect(taxaAnuenciaBpsFor('Consórcio XPTO')).toBe(DEFAULT_TAXA_ANUENCIA_BPS);
  });

  it('todas as marcas conhecidas ficam em 100–300 bps', () => {
    for (const nome of ['embracon', 'porto', 'bradesco', 'caixa', 'itau']) {
      const bps = taxaAnuenciaBpsFor(nome);
      expect(bps).toBeGreaterThanOrEqual(100);
      expect(bps).toBeLessThanOrEqual(300);
    }
  });
});
