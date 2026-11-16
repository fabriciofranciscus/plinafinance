// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompradorPipeline } from '../comprador-pipeline';
import Loading from '../loading';
import ErroDoPainel from '../error';

afterEach(cleanup);

// GUIA-PARTE-2 da Íris (§3, §7, §8, §9.1, §10, §12): um só "Sair"; vazios com palavra; carregando e falha do painel.
const pagina = readFileSync('app/admin/page.tsx', 'utf8');

describe('um só "Sair" (o do cabeçalho do app)', () => {
  it('a página do painel não tem o botão nem a action de logout', () => {
    expect(pagina).not.toMatch(/logoutAction/);
    expect(pagina).not.toMatch(/>\s*Sair\s*</);
  });
});

describe('estados vazios com palavra', () => {
  it('Compradores: sem nome de rota', () => {
    const html = renderToStaticMarkup(<CompradorPipeline leads={[]} />);
    expect(html).toContain('Nenhum comprador ainda. Interesses e reservas feitos em Comprar aparecem aqui.');
    expect(html).not.toMatch(/\/comprar\/lead|\/comprar\/reservar|lead comprador/);
  });
  it('Cotas, Investidores e Auditoria (texto da Íris)', () => {
    expect(pagina).toContain('Nenhuma cota no pool.');
    expect(pagina).toContain('Cotas entram pela etapa 10 de uma solicitação.');
    expect(pagina).toContain('Nenhum investidor ainda.');
    expect(pagina).toContain('Quem concluir o cadastro em Investir aparece aqui.');
    expect(pagina).toContain('Nenhum evento registrado.');
    expect(pagina).not.toMatch(/Sem eventos\.|onboarded ainda/);
  });
});

describe('carregando o painel', () => {
  it('role=status com a frase e título do painel já no lugar', () => {
    render(<Loading />);
    expect(screen.getByRole('status').textContent).toBe('Carregando o painel…');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Painel Plina');
  });
});

describe('falha ao carregar o painel', () => {
  const erro = Object.assign(new Error('SEGREDO interno: select * from "Investidor"'), { digest: 'dg-12345' });

  it('título, orientação e código (digest); nunca a mensagem do erro', () => {
    const retry = vi.fn();
    const { container } = render(<ErroDoPainel error={erro} unstable_retry={retry} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Não foi possível carregar o painel.');
    expect(container.textContent).toContain('Nenhuma ação foi enviada. Tente de novo; se continuar, avise a equipe técnica com o código abaixo.');
    expect(container.textContent).toContain('dg-12345');
    expect(container.textContent).not.toMatch(/SEGREDO|select \*/);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('"Tentar de novo" chama o retry', () => {
    const retry = vi.fn();
    render(<ErroDoPainel error={erro} unstable_retry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('sem digest: diz "sem código"', () => {
    const { container } = render(<ErroDoPainel error={new Error('x')} unstable_retry={() => {}} />);
    expect(container.textContent).toContain('sem código');
  });
});
