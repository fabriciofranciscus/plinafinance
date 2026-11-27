import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Vera (#157, BAIXA): os textos do /admin variam por rede, mas nada travava a ligação da página com a configuração.
const pagina = readFileSync('app/admin/page.tsx', 'utf8');
const LIGACAO = "redePublica={process.env.STELLAR_NETWORK === 'PUBLIC'}";

describe('/admin: cada tela com texto por rede recebe a rede da configuração', () => {
  it.each(['VendedorPipeline', 'CompradorPipeline', 'ValidacaoForm', 'IncorporarCotaForm'])('%s', (componente) => {
    const usos = pagina.split(new RegExp(`<${componente}\\b`)).slice(1);
    expect(usos.length).toBeGreaterThan(0);
    // as propriedades de um uso terminam no primeiro "/>"
    for (const uso of usos) expect(uso.slice(0, uso.indexOf('/>'))).toContain(LIGACAO);
  });
});
