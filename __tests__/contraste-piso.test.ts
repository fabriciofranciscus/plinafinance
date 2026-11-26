import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A4 (backlog de usabilidade, 25/11) com a tabela de troca da Íris (passagens/2026-11-25-iris-a4-a5-contraste-foco.md):
// piso de opacidade (petróleo 70% em claro, off-white 60% em escuro), anel de foco por superfície e hover de botão off-white.
// Esta fatia cobre os arquivos que nenhum PR aberto toca; o resto entra depois que os PRs abertos forem para a main.
const ARQUIVOS = [
  'app/admin/login-form.tsx',
  'app/cessao/[id]/comprovante/page.tsx',
  'app/comprar/[reservaId]/comprovante/page.tsx',
  'app/cotas/[id]/page.tsx',
  'app/cotas/page.tsx',
  'app/entrar/page.tsx',
  'app/investir/_components/screens/classe.tsx',
  'app/investir/_components/screens/confirm.tsx',
  'app/investir/_components/screens/receipt.tsx',
  'app/investir/_components/shared/data-row.tsx',
  'app/investir/_components/shared/onboarding-progress.tsx',
  'app/investir/_components/shared/quote-cell.tsx',
  'app/investir/_components/shell/error-block.tsx',
  'app/investir/_components/shell/incident-report-modal.tsx',
  'app/investir/_components/shell/rail.tsx',
  'app/minha-posicao/_components/ResgateSection.tsx',
  'app/politica-clawback/page.tsx',
  'components/auth/LoginPanel.tsx',
  'components/vender/AcompanharPrivado.tsx',
  'components/vender/StepperVender.tsx',
];

// Linhas de estado desabilitado são isentas (WCAG 1.4.3): a Íris as deixa de fora da regra.
const linhas = (f: string) => readFileSync(f, 'utf8').split('\n').map((t, i) => ({ t, n: i + 1 })).filter(({ t }) => !/cursor-not-allowed/.test(t));

describe('piso de contraste nos arquivos migrados', () => {
  for (const f of ARQUIVOS) {
    describe(f, () => {
      const L = linhas(f);
      it('texto de petróleo em fundo claro nunca abaixo de 70% (sem /25 a /65)', () => {
        const ruins = L.filter(({ t }) => /text-base\/(25|30|35|40|45|50|55|60|65)\b/.test(t)).map(({ n }) => n);
        expect(ruins).toEqual([]);
      });
      it('texto off-white em fundo escuro nunca abaixo de 60% (sem /30, /40, /50)', () => {
        const ruins = L.filter(({ t }) => /text-lightBg\/(30|40|50)\b/.test(t)).map(({ n }) => n);
        expect(ruins).toEqual([]);
      });
      it('anel de foco em tela clara é signal-700, nunca ciano 500 (focus:ring-primary, focus-visible:outline-primary)', () => {
        const ruins = L.filter(({ t }) => /focus:ring-primary(?![-\w])|focus-visible:outline-primary(?![-\w])/.test(t)).map(({ n }) => n);
        expect(ruins).toEqual([]);
      });
      it('texto em tinta primary-deep (signal-600) vira signal-700: signal-600 só passa sobre branco e dá 3,89:1 sobre o cinza (Íris, 8d2f854)', () => {
        const ruins = L.filter(({ t }) => /text-primary-deep(?![-\w])/.test(t)).map(({ n }) => n);
        expect(ruins).toEqual([]);
      });
      it('botão com rótulo off-white usa hover signal-700 (off-white sobre signal-600 dá 3,89:1)', () => {
        const ruins = L.filter(({ t }) => /text-lightBg(?![/\w-])/.test(t) && /hover:bg-primary-deep(?![/\w-])/.test(t)).map(({ n }) => n);
        expect(ruins).toEqual([]);
      });
    });
  }

  it('o skip link mostra o foco em signal-700 (a página abre em claro), não em ciano 500', () => {
    const css = readFileSync('app/globals.css', 'utf8');
    const regra = css.slice(css.indexOf('.skip-link:focus'), css.indexOf('}', css.indexOf('.skip-link:focus')));
    expect(regra).toMatch(/outline:\s*2px solid var\(--color-signal-700\)/);
    expect(regra).not.toMatch(/#0EA7C7/i);
  });

  it('os estados desabilitados (isentos) continuam como estavam: nenhuma linha é alterada à força', () => {
    const conf = readFileSync('app/investir/_components/screens/confirm.tsx', 'utf8');
    expect(conf).toContain("'bg-white text-base/30 border-base/10 cursor-not-allowed'");
  });
});
