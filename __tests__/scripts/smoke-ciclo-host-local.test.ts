import { describe, expect, it } from 'vitest';
import { exigirHostLocal } from '../../scripts/smoke-ciclo/pg';

describe('smoke:ciclo — o banco é sempre local e descartável (nunca o Neon)', () => {
  it.each(['postgresql://u:p@127.0.0.1:5433/db', 'postgresql://u:p@localhost:5432/db', 'postgresql://u:p@[::1]:5432/db'])('aceita %s', (url) => {
    expect(() => exigirHostLocal(url)).not.toThrow();
  });
  it.each([
    'postgresql://u:p@ep-lucky-breeze-123.sa-east-1.aws.neon.tech/neondb',
    'postgresql://u:p@db.exemplo.com:5432/plina',
    'postgresql://u:p@127.0.0.1.evil.com:5432/db',
    'postgresql://u:p@10.0.0.5:5432/db',
  ])('recusa %s', (url) => {
    expect(() => exigirHostLocal(url)).toThrow(/LOCAL descartável/);
  });
  it('URL inválida é recusada sem vazar o conteúdo', () => {
    expect(() => exigirHostLocal('isto não é url com segredo')).toThrow('SMOKE_CICLO_PG_URL inválida.');
  });
});
