import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A linha 20261111020000_audit_tesouraria_legada_movida já está em `_prisma_migrations` (produção) com este checksum. O
 * Prisma compara o SHA-256 do arquivo: reformatar, trocar fim de linha ou editar a pasta faz o `migrate deploy` falhar.
 */
const CHECKSUM_EM_PRODUCAO = '664ad406741e1c68163a78ac41b67c2d097c620d390f1ec032af5f454bd34905';

describe('TES-2: migration do enum AcaoAudit', () => {
  it('o migration.sql é byte a byte o que já foi aplicado (checksum do _prisma_migrations)', () => {
    const bytes = readFileSync(join(process.cwd(), 'prisma/migrations/20261111020000_audit_tesouraria_legada_movida/migration.sql'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(CHECKSUM_EM_PRODUCAO);
    expect(bytes.includes(0x0d)).toBe(false); // sem CRLF
  });

  it('o schema.prisma tem o valor TESOURARIA_LEGADA_MOVIDA no enum AcaoAudit (o Client precisa lê-lo)', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const enumAcao = schema.slice(schema.indexOf('enum AcaoAudit {'));
    const corpo = enumAcao.slice(0, enumAcao.indexOf('\n}'));
    expect(corpo).toMatch(/^\s*TESOURARIA_LEGADA_MOVIDA\s*$/m);
  });
});
