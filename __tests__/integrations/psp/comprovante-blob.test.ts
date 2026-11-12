import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));
vi.mock('@vercel/blob', () => ({ put: m.put, get: m.get }));

import { ComprovanteBlobError, guardarComprovantePsp } from '@/lib/integrations/blob/comprovante-psp';

const BYTES = Buffer.from('{"tipo":"plina.comprovante-pix"}', 'utf8');
const existe = () => Object.assign(new Error('Vercel Blob: This blob already exists, use `allowOverwrite: true`'), {});
const arquivo = (b: Buffer) => ({ statusCode: 200, stream: new Response(new Uint8Array(b)).body });

beforeEach(() => { process.env.BLOB_READ_WRITE_TOKEN = 'token-de-teste'; m.put.mockReset(); m.get.mockReset(); });
afterEach(() => { delete process.env.BLOB_READ_WRITE_TOKEN; });

describe('guardarComprovantePsp', () => {
  it('grava privado, sem sobrescrever e sem sufixo aleatório', async () => {
    m.put.mockResolvedValue({});
    expect(await guardarComprovantePsp({ cessaoId: 'c1', bytes: BYTES })).toEqual({ pathname: 'comprovantes-psp/c1.json' });
    expect(m.put).toHaveBeenCalledWith('comprovantes-psp/c1.json', BYTES, expect.objectContaining({ access: 'private', allowOverwrite: false, addRandomSuffix: false }));
  });
  it('F-E12-4: já existe com o MESMO conteúdo → ok', async () => {
    m.put.mockRejectedValue(existe());
    m.get.mockResolvedValue(arquivo(BYTES));
    await expect(guardarComprovantePsp({ cessaoId: 'c1', bytes: BYTES })).resolves.toEqual({ pathname: 'comprovantes-psp/c1.json' });
  });
  it('F-E12-4: já existe com OUTRO conteúdo → DIVERGE (não aceita arquivo trocado no mesmo caminho)', async () => {
    m.put.mockRejectedValue(existe());
    m.get.mockResolvedValue(arquivo(Buffer.from('{"adulterado":true}')));
    await expect(guardarComprovantePsp({ cessaoId: 'c1', bytes: BYTES })).rejects.toMatchObject({ motivo: 'DIVERGE' });
  });
  it('já existe mas o arquivo não pode ser lido → FALHOU (não afirma que confere)', async () => {
    m.put.mockRejectedValue(existe());
    m.get.mockResolvedValue(null);
    await expect(guardarComprovantePsp({ cessaoId: 'c1', bytes: BYTES })).rejects.toMatchObject({ motivo: 'FALHOU' });
  });
  it('outro erro do Blob → FALHOU; sem token → SEM_TOKEN, sem rede', async () => {
    m.put.mockRejectedValue(new Error('rede'));
    await expect(guardarComprovantePsp({ cessaoId: 'c1', bytes: BYTES })).rejects.toBeInstanceOf(ComprovanteBlobError);
    delete process.env.BLOB_READ_WRITE_TOKEN;
    m.put.mockClear();
    await expect(guardarComprovantePsp({ cessaoId: 'c1', bytes: BYTES })).rejects.toMatchObject({ motivo: 'SEM_TOKEN' });
    expect(m.put).not.toHaveBeenCalled();
  });
});
