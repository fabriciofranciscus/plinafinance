import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import InicioView from '@/components/me/InicioView';
import { RESUMO_CONTA_NOVA_EXEMPLO, RESUMO_EXEMPLO } from '@/lib/me/exemplos';
import type { ResumoDaConta } from '@/lib/me/tipos';

const ok = (resumo: ResumoDaConta, exemplo = false) => renderToStaticMarkup(<InicioView exemplo={exemplo} estado={{ tipo: 'ok', resumo }} />);
const sem = (over: Partial<ResumoDaConta>): ResumoDaConta => ({ ...RESUMO_EXEMPLO, ...over });

describe('/inicio (spec de UX §2)', () => {
  it('com saldo e proposta aguardando: próxima ação "Responder à proposta", posição com 4 casas e link do snapshot, em andamento', () => {
    const html = ok(RESUMO_EXEMPLO);
    expect(html).toContain('Olá, Marina (exemplo)');
    expect(html).toContain('Responder à proposta da solicitação #A1B2C3');
    expect(html).toContain('href="/vender/acompanhar/exemplo000000a1b2c3"');
    expect(html).toMatch(/1\.250,0000/);
    expect(html).toMatch(/NAV por token<\/dt><dd[^>]*>R\$\s1,0000/);
    expect(html).toContain('Valor de referência (NAV)');
    expect(html).toContain('Não é preço garantido de compra ou venda.');
    expect(html).toContain('Pool e valor do token');
    expect(html).toContain('Política de clawback (revogação de tokens, só nos casos previstos)');
    expect(html).toContain('https://stellar.expert/explorer/testnet/tx/e000');
    expect(html).toContain('Em andamento');
    expect(html).toContain('Etapa 4 de 6 · Proposta');
    expect(html).toContain('Imóvel · carta');
    expect(html).toContain('Aguardando sua resposta');
    expect(html).toContain('Entrada no pool');
    expect(html).toContain('Em conferência (pagamento simulado)');
    expect(html).toContain('Ver posição completa');
    expect(html).toContain('href="/sacar"');
  });

  it('conta nova: só "Escolha por onde começar" com dois botões; sem Posição nem Em andamento; Atalhos presentes', () => {
    const html = ok(RESUMO_CONTA_NOVA_EXEMPLO);
    expect(html).toContain('Sua conta');
    expect(html).toContain('Escolha por onde começar');
    expect(html).toContain('Investir (testnet)');
    expect(html).toContain('Vender uma cota');
    expect(html).not.toContain('Em andamento');
    expect(html).not.toContain('>Posição<');
    expect(html).toContain('aria-label="Atalhos"');
  });

  it('NAV indisponível: "—" nos dois valores e a frase fixa; nunca 1,0000 nem 0 no lugar', () => {
    const html = ok(sem({ posicao: { ...RESUMO_EXEMPLO.posicao!, navPorToken: null, valorPeloNav: null, navIndisponivel: true } }));
    expect(html).toContain('NAV indisponível agora. O saldo em PLINA-RF não muda.');
    expect(html).toMatch(/Valor de referência \(NAV\)<\/dt><dd[^>]*>—/);
    expect(html).toMatch(/NAV por token<\/dt><dd[^>]*>—/);
    expect(html).not.toMatch(/R\$\s1,0000/);
    expect(html).toContain('1.250,0000');
  });

  it('investidor sem saldo: 0,0000, "Você ainda não tem PLINA-RF." e sem botão Sacar', () => {
    const html = ok(sem({ solicitacoes: [], operacoesPendentes: [], posicao: { ...RESUMO_EXEMPLO.posicao!, tokens: '0.0000', valorPeloNav: '0.00' } }));
    expect(html).toContain('Você ainda não tem PLINA-RF.');
    expect(html).toContain('0,0000');
    expect(html).not.toContain('href="/sacar"');
  });

  it('nome que é e-mail nunca vira título', () => {
    const html = ok(sem({ nome: 'pessoa@exemplo.test' }));
    expect(html).toContain('Sua conta');
    expect(html).not.toContain('pessoa@exemplo.test');
  });

  it('cedente puro não vê Posição zerada', () => {
    const html = ok(sem({ papeis: ['CEDENTE'], posicao: null }));
    expect(html).not.toContain('>Posição<');
    expect(html).toContain('Em andamento');
  });

  it('carregando e erro total: cabeçalho presente, status/alerta e Atalhos visíveis', () => {
    const c = renderToStaticMarkup(<InicioView estado={{ tipo: 'carregando' }} />);
    expect(c).toContain('role="status"');
    expect(c).toContain('Atalhos');
    const e = renderToStaticMarkup(<InicioView estado={{ tipo: 'erro', onTentarDeNovo: () => {} }} />);
    expect(e).toContain('Não foi possível carregar sua conta agora.');
    expect(e).toContain('Tentar de novo');
    expect(e).toContain('Atalhos');
  });

  it('dados de exemplo aparecem sempre com a faixa; sem ela, não', () => {
    expect(ok(RESUMO_EXEMPLO, true)).toContain('Dados de exemplo (fictícios)');
    expect(ok(RESUMO_EXEMPLO, false)).not.toContain('Dados de exemplo');
  });

  it('sem termos proibidos e sem variação percentual', () => {
    const html = ok(RESUMO_EXEMPLO);
    expect(html).not.toMatch(/rendimento|retorno|yield|oferta firme|lastro/i);
    expect(html).not.toMatch(/\d\s?%/);
  });
});
