import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ cessao: vi.fn(), eventos: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { cessao: { findUnique: m.cessao }, eventoAudit: { findMany: m.eventos } } }));

import ComprovantePage from '@/app/cessao/[id]/comprovante/page';

const HASH = 'c642a78be3294a688ae0a141db6f036dbd7832aa490f238511010109bba7937a';
beforeEach(() => {
  m.cessao.mockReset().mockResolvedValue({
    id: 'cmabc123', status: 'ASSINADA', hashDocumento: HASH, onChainTxHash: 'a'.repeat(64), assinadaEm: new Date('2026-11-15T05:30:00Z'),
    docusignEnvelopeId: 'env-1', pagamento: null, cota: null,
    oferta: { valorLiquidoVendedor: '31200', desagioAquisicao: '0.22', tipoBem: 'IMOVEL', administradora: 'Administradora Demonstração (fictícia)' },
  });
  m.eventos.mockReset().mockResolvedValue([]);
});
const html = async () => renderToStaticMarkup(await ComprovantePage({ params: Promise.resolve({ id: 'cmabc123' }) }));

describe('/cessao/[id]/comprovante — texto do hash do documento', () => {
  it('não manda mais hashear "o PDF que você assinou": diz que o hash é o da cópia guardada pela Plina', async () => {
    const h = await html();
    expect(h).not.toMatch(/PDF que voc/);
    expect(h).toContain('cópia do PDF assinado que a Plina guardou');
    expect(h).toContain(HASH);
  });
  it('não oferece download do PDF (o arquivo não é servido por esta página)', async () => {
    expect(await html()).not.toMatch(/\/api\/cessao\/.*\/documento|Baixar a cópia/);
  });
});
