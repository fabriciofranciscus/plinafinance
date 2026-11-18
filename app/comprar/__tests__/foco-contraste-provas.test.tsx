// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { useRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { Rail } from '../_components/shell/rail';
import { DiligenciaScreen } from '../_components/screens/diligencia';
import { CessaoScreen } from '../_components/screens/cessao';
import { ConfirmacaoScreen } from '../_components/screens/confirmacao';
import { useFocoNoTitulo } from '../_hooks/use-foco-titulo';
import { explorerTx, subtelaDaFase } from '../_lib/glossary';
import type { CessaoData, CotaResumo, DiligenciaData, ReservaData } from '../_types';

// AP-5 /comprar, PR 3 (Íris, comprar-composicao/SPEC.md C5, C8, C9, C10): foco no h1, contraste e aria-current, links de
// tx e a confirmação realizada alinhada. Só composição: nenhum texto novo, nenhuma requisição nova.
const H = (c: string) => c.repeat(64);
const cota: CotaResumo = { id: 'c1', tipoBem: 'IMOVEL', valorCarta: 200000, desagioRevenda: 0.25, localizacaoAprox: 'Campinas, SP', prazoRestanteMeses: 0, statusEstoque: 'DISPONIVEL' };
const reserva = { reservaId: 'res-1234567890abcdef', expiraEm: '2026-11-20T15:30:00.000Z', txHash: H('a') } as ReservaData;
const cessao = { cessaoCompradorId: 'ces-1234567890abcdef', hashDocumento: H('d'), txHash: H('c'), reused: false } as CessaoData;
const pessoa = { nome: 'Comprador Teste', email: 'c@exemplo.test' } as never;
const diligencia = {
  cota: { id: 'c1', tipoBem: 'IMOVEL', valorCarta: 200000, desagioRevenda: 0.25, localizacaoAprox: null, prazoRestanteMeses: 0, status: 'X', statusEstoque: 'D', tokensEmitidos: 200000, emissaoTxHash: H('e'), hashValidacao: H('f'), validacaoTxHash: H('v'), hashCessao: H('b') },
  eventos: [
    { acao: 'COTA_VALIDADA', payloadHash: null, stellarTxHash: H('1'), criadoEm: '2026-11-17T00:00:00Z' },
    { acao: 'TOKEN_EMITIDO', payloadHash: null, stellarTxHash: null, criadoEm: '2026-11-17T00:00:00Z' },
  ],
} as unknown as DiligenciaData;
const URL_TX = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const src = (p: string) => readFileSync(`app/comprar/${p}`, 'utf8');

afterEach(cleanup);

describe('aria-current e contraste (C10)', () => {
  it('trilho: a fase atual e a subtela atual têm aria-current="step"; as outras não', () => {
    const { container } = render(<Rail current="kyc" />);
    const atuais = [...container.querySelectorAll('[aria-current="step"]')].map((e) => e.textContent);
    expect(atuais).toHaveLength(2);
    expect(atuais[0]).toMatch(/Cessão digital/);
    expect(atuais[1]).toBe('KYC');
    expect(container.querySelectorAll('li[aria-current]')).toHaveLength(2);
  });

  it('nenhum texto abaixo do piso: sem base/35, /40, /50, /55, /60 em page, trilho e telas', () => {
    const arquivos = ['page.tsx', '_components/shell/rail.tsx', '_components/shell/faixa-contexto.tsx', ...readdirSync('app/comprar/_components/screens').map((f) => `_components/screens/${f}`)];
    for (const a of arquivos) expect(src(a), a).not.toMatch(/text-base\/(35|40|50|55|60)\b/);
  });

  it('sobre lightBg (trilho e cabeçalho celular) o primary-deep não é texto; só barra/ponto decorativos', () => {
    expect(src('_components/shell/rail.tsx')).not.toMatch(/text-primary-deep/);
    expect(src('page.tsx')).not.toMatch(/text-primary-deep/);
  });
});

describe('links de transação (C5)', () => {
  it('explorerTx monta o link com o hash completo', () => {
    expect(explorerTx(H('a'))).toBe(URL_TX(H('a')));
  });

  it('diligência: Tx de validação, Tx de emissão e cada evento com hash viram link com o hash COMPLETO; laudo e hash de cessão seguem texto; nulo vira "—" sem link', () => {
    render(<DiligenciaScreen selectedCota={cota} data={diligencia} loading={false} onContinue={() => {}} />);
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual([URL_TX(H('v')), URL_TX(H('e')), URL_TX(H('1'))]);
    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a.className).toContain('min-h-[44px]');
    }
    expect(screen.getByText(/Hash do laudo/).nextElementSibling?.querySelector('a')).toBeNull();
    const item = screen.getByText(/PLINA-RF emitido ·/).closest('li')!;
    expect(item.textContent).toContain('—');
    expect(item.querySelector('a')).toBeNull();
  });

  it('cessão: o tx da reserva é link; a confirmação inicial linka o tx da cessão e o hash do documento segue texto', () => {
    const c = render(<CessaoScreen pessoa={pessoa} cota={cota} reserva={reserva} cessao={null} signing={false} onAssinar={() => {}} />);
    expect(c.container.querySelector(`a[href="${URL_TX(H('a'))}"]`)).toBeTruthy();
    c.unmount();
    const k = render(<ConfirmacaoScreen cota={cota} reserva={reserva} cessao={cessao} confirmacao={null} confirming={false} onConfirmar={() => {}} />);
    expect(k.container.querySelector(`a[href="${URL_TX(H('c'))}"]`)).toBeTruthy();
    expect(k.container.querySelector(`a[href*="${H('d')}"]`)).toBeNull();
    expect(k.container.textContent).toContain(`hash ${H('d').slice(0, 10)}…`);
  });
});

describe('semântica (h2 nos blocos)', () => {
  it('"Jurídico", "On-chain", "Documento" e "Próximos passos" são h2', () => {
    const d = render(<DiligenciaScreen selectedCota={cota} data={diligencia} loading={false} onContinue={() => {}} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Jurídico', 'On-chain']);
    d.unmount();
    const c = render(<CessaoScreen pessoa={pessoa} cota={cota} reserva={reserva} cessao={null} signing={false} onAssinar={() => {}} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Documento' })).toBeTruthy();
    c.unmount();
    render(<ConfirmacaoScreen cota={cota} reserva={reserva} cessao={cessao} confirmacao={{ status: 'REALIZADA', valorRealizado: '150000', txHash: H('r') } as never} confirming={false} onConfirmar={() => {}} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Próximos passos' })).toBeTruthy();
  });
});

describe('confirmação realizada alinhada (C8, D1 do Atlas: sem o círculo ✓)', () => {
  const ok = { status: 'REALIZADA', valorRealizado: '150000', txHash: H('r') } as never;
  const montar = () => render(<ConfirmacaoScreen cota={cota} reserva={reserva} cessao={cessao} confirmacao={ok} confirming={false} onConfirmar={() => {}} />);

  it('alinhada à esquerda, com o sobretítulo "05 // Transferência", e sem o círculo de celebração', () => {
    const { container } = montar();
    expect(container.querySelector('.text-center')).toBeNull();
    expect(container.querySelector('.rounded-full')).toBeNull();
    expect(screen.getByText('05 // Transferência')).toBeTruthy();
    expect(screen.queryByText('✓')).toBeNull();
  });

  it('os textos protegidos (N4/N5) ficam iguais: título, "Você agora é titular…", três valores, aviso de cotas quitadas, próximos passos', () => {
    montar();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Cessão concluída');
    expect(screen.getByText('Você agora é titular da carta de crédito.')).toBeTruthy();
    for (const k of ['Carta de crédito', 'Pago', 'Diferença para o valor de face']) expect(screen.getByText(k)).toBeTruthy();
    expect(screen.getByText('Nesta fase, só são aceitas cotas quitadas (sem parcelas restantes).')).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((l) => l.textContent)).toEqual([
      '→ Contate a administradora para a transferência de titularidade.',
      '→ Utilize a carta de crédito para aquisição do bem.',
      '→ Baixe o documento de cessão para seus registros.',
    ]);
  });

  it('três valores em 1 coluna no celular e 3 de sm em diante; sem a faixa de contexto (os valores têm rótulos próprios)', () => {
    const { container } = montar();
    const grade = screen.getByText('Carta de crédito').closest('div')!.parentElement!;
    expect(grade.className).toContain('grid-cols-1');
    expect(grade.className).toContain('sm:grid-cols-3');
    expect(container.querySelector('[data-testid="faixa-contexto"]')).toBeNull();
  });

  it('provas em linhas separadas (reserva, cessão, realização), cada uma com link; "Ver comprovante" primário e "Verificar on-chain" secundário', () => {
    const { container } = montar();
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(URL_TX(H('a')));
    expect(hrefs).toContain(URL_TX(H('c')));
    expect(hrefs).toContain(URL_TX(H('r')));
    const comprovante = screen.getByRole('link', { name: 'Ver comprovante →' });
    const verificar = screen.getByRole('link', { name: 'Verificar on-chain ↗' });
    expect(comprovante.className).toContain('bg-base');
    expect(verificar.className).not.toContain('bg-base ');
    expect(comprovante.getAttribute('href')).toBe('/comprar/res-1234567890abcdef/comprovante');
  });
});

describe('foco no h1 a cada troca de tela (C9)', () => {
  function Casa({ chave }: { chave: string }) {
    const raiz = useRef<HTMLDivElement>(null);
    useFocoNoTitulo(chave, raiz);
    return (
      <div ref={raiz}>
        <button>Antes</button>
        <h1>{`Título ${chave}`}</h1>
      </div>
    );
  }

  it('não move o foco na carga; ao trocar a chave foca o h1 novo (tabindex -1); a mesma chave não refoca', () => {
    const { rerender } = render(<Casa chave="buscar" />);
    expect(document.activeElement).toBe(document.body);
    rerender(<Casa chave="diligencia" />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(document.activeElement).toBe(h1);
    expect(h1.getAttribute('tabindex')).toBe('-1');
    screen.getByRole('button', { name: 'Antes' }).focus();
    rerender(<Casa chave="diligencia" />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Antes' }));
  });

  it('o topo do conteúdo vai à viewport sem animação', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { rerender } = render(<Casa chave="buscar" />);
    rerender(<Casa chave="proposta" />);
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
  });

  it('a página usa o hook com a tela e o estado da confirmação, não com dados recarregados', () => {
    const page = src('page.tsx');
    expect(page).toMatch(/useFocoNoTitulo\(`\$\{screen\}:\$\{flow\.cessao\.confirmacao\?\.status \?\? ''\}`/);
  });
});

describe('cabeçalho do celular: subtela só em fase com mais de uma tela (C11)', () => {
  it('fases de uma tela não mostram subtela', () => {
    for (const s of ['buscar', 'diligencia', 'proposta', 'confirmacao'] as const) expect(subtelaDaFase(s)).toBeNull();
  });
  it('"Cessão digital" mostra o rótulo existente da subtela', () => {
    expect(subtelaDaFase('kyc')).toBe('KYC');
    expect(subtelaDaFase('cessao')).toBe('Assinatura');
  });
  it('a página usa essa regra no cabeçalho (sem repetir a condição)', () => {
    expect(src('page.tsx')).toContain('subtelaDaFase(screen)');
    expect(src('page.tsx')).not.toMatch(/phase\.screens\.length > 1/);
  });
});
