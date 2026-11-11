import type { Dictionary } from '../types';

export const ptBR: Dictionary = {
  meta: {
    title: 'Plina',
    description:
      'A Plina está desenvolvendo uma estrutura para cotas contempladas de consórcio, com registros verificáveis em rede de testes. Sem oferta de investimento.',
    twitterDescription:
      'Cotas contempladas de consórcio, com registro verificável em rede de testes. Em desenvolvimento.',
    keywords: [
      'cotas contempladas',
      'consórcio',
      'Stellar',
      'registro verificável',
      'rede de testes',
    ],
  },
  siteHeader: {
    skipLink: 'Pular para conteúdo',
    nav: {
      produto: 'Modelo',
      tese: 'Tese',
      compliance: 'Compliance',
      equipe: 'Equipe',
    },
    painel: 'Painel',
    sair: 'Sair',
    registrarInteresse: 'Falar com o time',
    menuAbrir: 'Abrir menu',
    menuFechar: 'Fechar menu',
    languageSwitcher: { pt: 'PT', en: 'EN' },
  },
  consoleStrip: {
    aberto: 'Em desenvolvimento · Rede de testes · Sem oferta em andamento',
    cta: 'Falar com o time →',
  },
  hero: {
    linha1: 'Cotas contempladas de consórcio.',
    linha2: 'Registro verificável.',
    destaque: 'Em desenvolvimento,',
    linha3Fim: 'em rede de testes.',
    sub: 'Estamos desenvolvendo a originação de cotas contempladas de consórcio, com registros verificáveis na Stellar testnet. Esta página não é oferta nem solicitação de investimento.',
  },
  produto: {
    numMarker: '01',
    marker: 'Modelo',
    titulo: ['Estrutura', ' em testes', '.'],
    intro:
      'Estamos desenvolvendo a originação de cotas contempladas de consórcio, com registro digital dos eventos de cada cota. A Plina não é corretora. Esta página não é oferta nem solicitação de investimento.',
    especificacoes: [
      {
        label: 'Ativo',
        value: 'Cota contemplada de consórcio',
        detail: 'Direito de crédito sujeito às regras do grupo e à anuência da administradora.',
      },
      {
        label: 'Estágio',
        value: 'Rede de testes',
        detail:
          'Estrutura institucional planejada para fase futura, sujeita a aprovação regulatória e à documentação aplicável.',
      },
      {
        label: 'Registro',
        value: 'Digital, em testnet',
        detail: 'Cada evento da cota deixa um registro verificável na Stellar testnet.',
      },
      {
        label: 'Contato',
        value: 'Exploratório',
        detail: 'Nenhuma oferta de investimento em andamento.',
      },
    ],
  },
  tese: {
    numMarker: '02',
    marker: 'Tese',
    titulo: ['Três caminhos.', 'Um modelo.'],
    intro:
      'O modelo prevê três caminhos de realização, conforme as regras de cada grupo e administradora. Tudo aqui está em desenvolvimento.',
    tableCaption: 'Os três caminhos de realização previstos no modelo',
    colCaminho: 'Caminho',
    rowDuration: 'Prazo',
    rowEstagio: 'Estágio',
    rowMix: 'Peso no modelo',
    caminhos: [
      {
        letra: 'A',
        titulo: ['Revenda ao', 'Comprador-Usuário'],
        duration: 'A definir',
        estagio: 'Em desenvolvimento',
        mix: 'A definir',
        body: 'O modelo prevê a revenda da cota a um comprador aprovado pela administradora. Esse canal ainda não está em operação.',
      },
      {
        letra: 'B',
        titulo: ['Liquidação por', 'Administradora'],
        duration: 'Conforme a administradora',
        estagio: 'Em desenvolvimento',
        mix: 'A definir',
        body: 'Para cotas elegíveis, a administradora pode converter a contemplação em pagamento em dinheiro, conforme a regulamentação aplicável. Caminho previsto no modelo, ainda em desenvolvimento.',
      },
      {
        letra: 'C',
        titulo: ['Liquidação por', 'Prazo de Grupo'],
        duration: 'Conforme o prazo do grupo',
        estagio: 'Em desenvolvimento',
        mix: 'A definir',
        body: 'Para cotas não realizadas pelos caminhos A ou B, o crédito é realizado ao final do prazo do grupo, nas condições contratuais. Sem garantia de prazo ou de valor.',
      },
    ],
    rodape:
      'Nenhuma composição, prazo ou resultado está definido ou garantido. O modelo está em desenvolvimento.',
  },
  bigStatement: {
    numMarker: '03',
    marker: 'Marco Regulatório',
    p1: 'A Lei 11.795 regulamentou o mercado brasileiro de consórcios em 2008. Há quase duas décadas o direito creditório de cotas contempladas é juridicamente constituído. A Plina estuda novos caminhos de realização para ele.',
    p2: 'A Plina desenvolve a originação dessas cotas, com registro verificável em rede de testes.',
    milestones: [
      { year: '2008', label: 'Lei 11.795 regulamenta consórcios brasileiros' },
      { year: '2026', label: 'Plina · registros em rede de testes' },
      { year: 'Depois', label: 'Fases seguintes, sujeitas a aprovação regulatória' },
    ],
  },
  compliance: {
    numMarker: '04',
    marker: 'Compliance',
    titulo: ['Compliance', 'desde o desenho.'],
    intro:
      'Reversibilidade e rastreabilidade são requisitos de qualquer estrutura regulada. A Plina os trata como requisito de desenho desde o início.',
    principios: [
      {
        num: '01',
        titulo: 'Auditável',
        tag: 'Verificável · Rede de testes',
        detalhe:
          'No modelo, cada evento da cota gera um registro digital verificável. Hoje, em rede de testes.',
      },
      {
        num: '02',
        titulo: 'Base legal',
        tag: 'Lei 11.795/2008',
        detalhe:
          'O modelo parte da Lei 11.795/2008, dos consórcios. Uma estrutura institucional é planejada para fase futura, sujeita a aprovação regulatória.',
      },
      {
        num: '03',
        titulo: 'Reversível',
        tag: 'Clawback · Autorização · Revogabilidade',
        detalhe:
          'Política de clawback pública, restrita a quatro hipóteses jurídicas explícitas. Reversibilidade institucional como diferencial competitivo, não como limitação técnica.',
      },
    ],
  },
  equipe: {
    numMarker: '05',
    marker: 'Equipe Fundadora',
    membros: [
      {
        operatorId: '01',
        nome: 'Fabrício Santos',
        cargo: 'CEO & Founder',
        bio: 'Sócio fundador da Citrino, assessoria financeira de planejamento e gestão patrimonial. Atuou em estratégias de receita, custo e experiência do cliente na plataforma digital de crédito Simplic, e liderou na TOTVS a implementação do sistema corporativo de KPIs para a Diretoria e o Conselho Administrativo.',
      },
      {
        operatorId: '02',
        nome: 'Thais Reis',
        cargo: 'CTO & Protocol Lead',
        bio: 'Engenheira full-stack com cinco anos em infraestrutura blockchain — engenharia de dados, backend, contratos automatizados em Rust e interfaces em React/TypeScript. Fundadora e Lead Engineer do Karn Ecosystem, plataforma de governança de código aberto. Premiada em competições nacionais e internacionais de tecnologia descentralizada e inteligência artificial.',
      },
    ],
  },
  leadCapture: {
    numMarker: '06',
    marker: 'Contato',
    headingIdle: ['Fale com', 'o time.'],
    headingSuccess: ['Contato', 'registrado.'],
    subIdle:
      'Preencha os campos abaixo para falar com a equipe da Plina. Contato exploratório: esta página não é oferta nem solicitação de investimento.',
    subSuccess: 'Recebemos seu contato. Nossa equipe responderá por e-mail.',
    fields: {
      nome: 'Nome completo *',
      nomePlaceholder: 'Nome e sobrenome',
      org: 'Organização *',
      orgPlaceholder: 'Family office, gestora, fundo...',
      email: 'E-mail corporativo *',
      emailPlaceholder: 'nome@organização.com',
      telefone: 'Telefone / WhatsApp',
      telefonePlaceholder: '+55 11 99999-9999',
      perfil: 'Perfil *',
      jurisdicao: 'Jurisdição principal',
      jurisdicaoPlaceholder: 'Brasil, EUA, Cingapura...',
      observacoes: 'Observações / perguntas',
      observacoesPlaceholder: 'Restrições de compliance, exigências específicas de estrutura, perguntas iniciais...',
      selecione: 'Selecione',
    },
    selectOptions: {
      profile: {
        'family-office-br': 'Family office brasileiro',
        'family-office-int': 'Family office internacional',
        'gestora-br': 'Gestora de fundos (BR)',
        'gestora-int': 'Gestora multi-mercado (Internacional)',
        'fintech-latam': 'Fintech de investimento LATAM',
        outro: 'Outro — descrever nas observações',
      },
    },
    lgpdNotice:
      'Autorizo a Plina Finance a usar os dados deste formulário para responder a este contato. Eles ficam em provedores de e-mail e hospedagem contratados pela Plina, são guardados pelo tempo necessário para responder e não são usados para outra finalidade. Para pedir acesso, correção ou eliminação, escreva para contato@plina.finance.',
    submitIdle: 'Enviar contato',
    submitPending: 'Enviando…',
    footerNote:
      'Contato exploratório · Esta página não é oferta nem solicitação de investimento · Em desenvolvimento',
    successPanel: {
      protocolo: 'Protocolo',
      passos: [
        { ordem: '01', titulo: 'Confirmação imediata', detalhe: 'Recebemos seu contato e o registro foi gerado.' },
        {
          ordem: '02',
          titulo: 'Resposta',
          detalhe: 'Nossa equipe responde por e-mail. Não há documentação de oferta: nenhuma oferta está em andamento.',
        },
        {
          ordem: '03',
          titulo: 'Conversa com o time',
          detalhe: 'Se fizer sentido, agendamos uma conversa com o time fundador.',
        },
      ],
      duvidas: 'Dúvidas?',
    },
  },
  footer: {
    tagline: 'Cotas contempladas de consórcio, com registro verificável em rede de testes.',
    navegacao: 'Navegação',
    navLinks: {
      produto: 'Modelo',
      tese: 'Tese',
      compliance: 'Compliance',
      equipe: 'Equipe',
      registrarInteresse: 'Falar com o time',
    },
    contato: 'Contato',
    disclaimer:
      'A Plina Finance não é corretora. Esta página apresenta um modelo em desenvolvimento, em rede de testes. Não constitui oferta de valores mobiliários, promessa de rentabilidade ou garantia de liquidez. Uma estrutura institucional é planejada para fase futura, sujeita a aprovação regulatória e à documentação aplicável.',
    copyright: '© 2026 Plina Finance. Todos os direitos reservados.',
  },
  consoleFooter: {
    flags: ['Testnet', 'Em desenvolvimento', 'Lei 11.795/2008', 'Sem oferta em andamento'],
  },
};
