/**
 * DADOS DE EXEMPLO (fictícios) para pré-visualizar /inicio e /historico antes do
 * contrato de GET /api/me/* (item 12). Só aparecem com ?exemplo=1 e sempre com a
 * faixa "Dados de exemplo". Nenhum é de pessoa real; hashes e ids são inventados.
 */

import type { EventoHistorico, ResumoDaConta } from './tipos';

export const RESUMO_EXEMPLO: ResumoDaConta = {
  nome: 'Marina (exemplo)',
  papeis: ['INVESTIDOR', 'CEDENTE'],
  posicao: {
    tokens: '1250.0000',
    navPorToken: '1.0000',
    valorPeloNav: '1250.00',
    navFonte: 'ledger',
    snapshotEm: '2026-11-15T09:17:00Z',
    snapshotTxHash: 'e0000000000000000000000000000000000000000000000000000000000000ab',
  },
  solicitacoes: [
    {
      id: 'exemplo000000a1b2c3', status: 'OFERTA_ENVIADA', etapa: 3, tipoBem: 'IMOVEL',
      valorCarta: '150000.00', valorLiquido: '120000.00', ofertaValidade: '2026-11-17T21:00:00Z', cessaoStatus: null,
    },
  ],
  operacoesPendentes: [{ tipo: 'entrada', valor: 'R$ 500,00', situacao: 'aguardando o Pix', continuarEm: '/investir' }],
};

export const RESUMO_CONTA_NOVA_EXEMPLO: ResumoDaConta = {
  nome: null,
  papeis: [],
  posicao: null,
  solicitacoes: [],
  operacoesPendentes: [],
};

export const HISTORICO_EXEMPLO: EventoHistorico[] = [
  { id: 'h1', tipo: 'saida_do_pool', em: '2026-11-15T12:42:00Z', lado: 'investir', valorBrl: '200.00', tokens: '200.0000', situacao: 'concluido', txHash: '3f9a00000000000000000000000000000000000000000000000000000000c21e', referencia: null, link: null, simulado: true },
  { id: 'h2', tipo: 'entrada_no_pool', em: '2026-11-15T12:30:00Z', lado: 'investir', valorBrl: '500.00', tokens: '500.0000', situacao: 'concluido', txHash: 'a81b0000000000000000000000000000000000000000000000000000000077d0', referencia: null, link: null, simulado: true },
  { id: 'h3', tipo: 'cota_incorporada', em: '2026-11-15T05:14:00Z', lado: 'vender', valorBrl: null, tokens: null, situacao: 'concluido', txHash: '5c02000000000000000000000000000000000000000000000000000000009e4b', referencia: 'A1B2C3', link: '/vender/acompanhar/exemplo000000a1b2c3', simulado: false },
  { id: 'h4', tipo: 'pix_enviado', em: '2026-11-15T05:05:00Z', lado: 'vender', valorBrl: '120000.00', tokens: null, situacao: 'concluido', txHash: '77aa0000000000000000000000000000000000000000000000000000000001f3', referencia: 'A1B2C3', link: '/vender/acompanhar/exemplo000000a1b2c3', simulado: true },
  { id: 'h5', tipo: 'proposta_recebida', em: '2026-11-14T22:50:00Z', lado: 'vender', valorBrl: '120000.00', tokens: null, situacao: 'concluido', txHash: null, referencia: 'A1B2C3', link: '/vender/acompanhar/exemplo000000a1b2c3', simulado: false },
];
