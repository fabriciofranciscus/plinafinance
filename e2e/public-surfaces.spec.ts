import { expect, test } from '@playwright/test';

/**
 * Smoke das superfícies públicas — cada rota renderiza 200 e contém um
 * marcador estável (texto na hero) que sinaliza que o page component
 * de fato montou (não só o shell).
 */

const ROUTES: { path: string; expectText: RegExp }[] = [
  { path: '/', expectText: /Plina/i },
  { path: '/pool', expectText: /pool|NAV/i },
  { path: '/cotas', expectText: /cota/i },
  { path: '/politica-clawback', expectText: /clawback/i },
  { path: '/investir', expectText: /Acesso institucional|Investir|PLINA-RF/i },
  { path: '/sacar', expectText: /Sacar|TESOURO|PIX/i },
  { path: '/vender', expectText: /vender|cota|contemplad/i },
  { path: '/comprar', expectText: /comprar|cota|contemplad/i },
  { path: '/minha-posicao', expectText: /posi[çc][ãa]o|institucional|Plina/i },
];

for (const { path, expectText } of ROUTES) {
  test(`renderiza ${path}`, async ({ page }) => {
    const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(res?.status(), `status de ${path}`).toBeLessThan(400);
    await expect(page.locator('body')).toContainText(expectText);
  });
}

/** Caixa e acento não escondem um nome ("Fabrício" = "fabricio"). */
const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Nomes de pessoa que não podem aparecer no stellar.toml: os fundadores. A landing v2 não tem
 * a seção de equipe (os nomes antes vinham de `dict.equipe`), então o piso fixo é a lista.
 */
function nomesDePessoas(): string[] {
  return ['Thais Reis', 'Fabricio Santos'].map(semAcento);
}

const EMAIL_OFICIAL = 'contato@plina.finance';

test('stellar.toml é servido com CORS e PLINARF, sem principais, nomes de pessoa nem e-mails pessoais', async ({
  request,
}) => {
  const res = await request.get('/.well-known/stellar.toml');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/PLINARF/);
  expect(body).toMatch(/ORG_OFFICIAL_EMAIL = "contato@plina\.finance"/);
  expect(body).toMatch(/ORG_LOGO/);
  // Decisão da Thais (Z16): sem a seção de principais, sem nome de pessoa e sem e-mail pessoal
  // no arquivo público. O único contato é o e-mail oficial da organização.
  expect(body, 'seção [[PRINCIPALS]] não pode voltar').not.toMatch(/\[\[\s*PRINCIPALS\s*\]\]/i);
  const texto = semAcento(body);
  for (const nome of nomesDePessoas()) {
    expect(texto, `nome de pessoa no stellar.toml: ${nome}`).not.toContain(nome);
  }
  const emails = body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  expect(
    emails.filter((e) => e.toLowerCase() !== EMAIL_OFICIAL),
    'só o e-mail oficial da organização pode aparecer',
  ).toEqual([]);
  // SEPs documentados como comentário (Fase 1)
  expect(body).toMatch(/SEP-6|SEP-10|SEP-38/);
  expect(res.headers()['access-control-allow-origin']).toBeTruthy();
});
