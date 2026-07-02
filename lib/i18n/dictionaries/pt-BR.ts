import type { Dictionary } from '../types';

export const ptBR: Dictionary = {
  meta: {
    title: 'Plina',
    description:
      'Conectando capital global ao direito creditório brasileiro. PLINA-RF: token institucional lastreado em FIDC sob CVM 175, distribuído via Stellar.',
    twitterDescription:
      'Conectando capital global ao direito creditório brasileiro via Stellar. FIDC sob CVM 175.',
    keywords: [
      'tokenização institucional',
      'direito creditório',
      'FIDC',
      'CVM 175',
      'Stellar',
      'RWA',
      'consórcio contemplado',
      'PLINA-RF',
    ],
  },
  siteHeader: {
    skipLink: 'Pular para conteúdo',
    nav: {
      produto: 'Produto',
      tese: 'Tese',
      compliance: 'Compliance',
      equipe: 'Equipe',
    },
    painel: 'Painel',
    sair: 'Sair',
    registrarInteresse: 'Registrar interesse',
    menuAbrir: 'Abrir menu',
    menuFechar: 'Fechar menu',
    languageSwitcher: { pt: 'PT', en: 'EN' },
  },
  consoleStrip: {
    aberto: 'Captação aberta para investidores institucionais qualificados',
    cta: 'Registrar interesse →',
  },
  hero: {
    linha1: 'Liquidez para o cotista.',
    linha2: 'Desconto para o comprador.',
    yieldDestaque: 'Yield institucional',
    linha3Fim: 'para o mundo.',
    subPrefix: 'Pool tokenizado de cotas de consórcio contempladas, estruturado como FIDC sob CVM 175 e emitido na Stellar como',
    subSuffix: '.',
  },
  produto: {
    numMarker: '01',
    marker: 'Produto',
    titulo: ['PLINA', '-RF', '.'],
    intro:
      'Cota de FIDC representada por um instrumento digital regulado, emitido sob a CVM 175. Não é uma corretora. Não é um fundo aberto de varejo. É o próprio instrumento financeiro tokenizado, com originação, custódia regulada e controles de conformidade integrados.',
    especificacoes: [
      {
        label: 'Lastro',
        value: '1 PLINA-RF = R$ 1,00',
        detail: 'Lastro em direito creditório com valor ajustado diariamente.',
      },
      {
        label: 'Veículo',
        value: 'FIDC · CVM 175',
        detail: 'Classes sênior e subordinada, prestadores registrados, auditoria Big Four.',
      },
      {
        label: 'Custódia',
        value: 'Custodiante regulado',
        detail: 'Registro digital auditável com bloqueio, autorização e reversibilidade institucional.',
      },
      {
        label: 'Aporte',
        value: 'USD · EUR · BRL',
        detail: 'Investidores internacionais e domésticos, com liquidação em USDC, EURC e moeda local.',
      },
    ],
  },
  tese: {
    numMarker: '02',
    marker: 'Tese',
    titulo: ['Três caminhos.', 'Um pool.'],
    intro:
      'Modelo híbrido de realização de valor. Geridos ativamente pelo gestor do FIDC e auditados trimestralmente. É onde a Plina constrói vantagem competitiva durável sobre incumbentes restritos ao Caminho B.',
    tableCaption:
      'Comparação dos três caminhos de realização de valor — duration, yield, mix-alvo e curva projetada',
    colCaminho: 'Caminho',
    rowDuration: 'Duration',
    rowYield: 'Yield',
    rowMix: 'Mix-Alvo',
    rowCurva: 'Curva projetada',
    caminhos: [
      {
        letra: 'A',
        titulo: ['Revenda ao', 'Comprador-Usuário'],
        duration: '30-90 dias',
        yieldLabel: 'Alto',
        mix: '40-60%',
        body: 'A diferença entre o preço pago ao vendedor original e o preço cobrado do comprador-usuário do bem é a fonte primária de yield. Operamos canal comercial dedicado para revenda de cotas a quem efetivamente vai usar a carta de crédito — pessoa física, construtora, transportadora, empresário.',
      },
      {
        letra: 'B',
        titulo: ['Liquidação por', 'Administradora'],
        duration: '90-180 dias',
        yieldLabel: 'Médio',
        mix: '30-50%',
        body: 'Para cotas elegíveis sob a Circular BACEN 3.432/2009, a administradora converte a contemplação em pagamento em dinheiro em até 180 dias. Caminho predominante dos incumbentes — operado pela Plina dentro da estrutura formal do FIDC, sem exposição regulatória de zona cinza.',
      },
      {
        letra: 'C',
        titulo: ['Liquidação por', 'Prazo de Grupo'],
        duration: '12-36 meses',
        yieldLabel: 'Contratado',
        mix: '10-20%',
        body: 'Para cotas não realizadas pelos caminhos A ou B, o direito creditório é realizado ao final do prazo regulado pelo BACEN com correção monetária contratual. Funciona como reserva técnica e piso de yield do pool.',
      },
    ],
    rodape:
      'Composição inicial-alvo documentada no regulamento do FIDC. Mix ajustado continuamente pelo gestor com base em condições de mercado.',
  },
  bigStatement: {
    numMarker: '03',
    marker: 'Marco Regulatório',
    p1: 'A Lei 11.795 regulamentou o mercado brasileiro de consórcios em 2008. Há quase duas décadas o direito creditório de cotas contempladas é juridicamente constituído, mas nunca chegou ao capital institucional global.',
    p2: 'A Plina é a primeira tokenizadora institucional sob CVM 175 desde a origem.',
    milestones: [
      { year: '2008', label: 'Lei 11.795 regulamenta consórcios brasileiros' },
      { year: '2023', label: 'CVM 175 estrutura tokenização institucional' },
      { year: '2026', label: 'Plina · primeira tokenizadora de direito creditório de consórcio' },
    ],
  },
  compliance: {
    numMarker: '04',
    marker: 'Compliance',
    titulo: ['Compliance', 'nativo.'],
    intro:
      'Para mesa de risco institucional, reversibilidade não é limitação. É requisito. Family offices e gestoras reguladas não alocam em ativo digital sem mecanismo formal de bloqueio e recuperação. Sem isso, o produto não passa em compliance.',
    principios: [
      {
        num: '01',
        titulo: 'Auditável',
        tag: 'Verificável publicamente · Registro imutável',
        detalhe:
          'Cada cota incorporada ao pool tem registro digital verificável publicamente, com lastro jurídico formal e imutável.',
      },
      {
        num: '02',
        titulo: 'Regulada',
        tag: 'CVM 175 · Lei 11.795/2008',
        detalhe:
          'CVM 175 e Lei 11.795/2008 desde a origem. FIDC formal, prestadores registrados, auditoria Big Four.',
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
    marker: 'Onboarding',
    headingIdle: ['Registre seu', 'interesse.'],
    headingSuccess: ['Interesse', 'registrado.'],
    subIdle:
      'Preencha os campos abaixo para manifestar interesse no PLINA-RF. Nossa equipe entrará em contato em até 48 horas para apresentação detalhada do instrumento.',
    subSuccess:
      'Nossa equipe entrará em contato em até 48 horas com apresentação detalhada do instrumento e documentação do FIDC.',
    fields: {
      nome: 'Nome completo *',
      nomePlaceholder: 'Nome e sobrenome',
      org: 'Organização *',
      orgPlaceholder: 'Family office, gestora, fundo...',
      email: 'E-mail corporativo *',
      emailPlaceholder: 'nome@organização.com',
      telefone: 'Telefone / WhatsApp',
      telefonePlaceholder: '+55 11 99999-9999',
      perfil: 'Perfil do investidor *',
      jurisdicao: 'Jurisdição principal',
      jurisdicaoPlaceholder: 'Brasil, EUA, Cingapura...',
      ticket: 'Tíquete indicativo *',
      moeda: 'Moeda de preferência',
      classe: 'Classe de interesse',
      prazo: 'Prazo de decisão',
      observacoes: 'Observações / perguntas',
      observacoesPlaceholder: 'Restrições de compliance, exigências específicas de estrutura, perguntas iniciais...',
      selecione: 'Selecione',
      selecioneOpcional: 'Selecione (opcional)',
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
      ticket: {
        '100k-500k': 'US$ 100k – 500k',
        '500k-1m': 'US$ 500k – 1M',
        '1m-5m': 'US$ 1M – 5M',
        '5m+': 'US$ 5M+',
        '500k-2m-brl': 'R$ 500k – 2M',
        '2m-10m-brl': 'R$ 2M – 10M',
        '10m+brl': 'R$ 10M+',
      },
      currency: {
        USDC: 'USDC',
        EURC: 'EURC',
        'BRL stablecoin (BRZ / BRLA)': 'BRL stablecoin (BRZ / BRLA)',
        'BRL fiat': 'BRL fiat',
        'Ainda indefinido': 'Ainda indefinido',
      },
      classe: {
        Sênior: 'Sênior (menor risco, retorno prioritário)',
        Subordinada: 'Subordinada (primeiras perdas, maior retorno potencial)',
        Ambas: 'Ambas — sujeito a modelagem',
        Indefinido: 'Indefinido',
      },
      timeline: {
        'Até 30 dias': 'Até 30 dias',
        '1 a 3 meses': '1 a 3 meses',
        '3 a 6 meses': '3 a 6 meses',
        'Mais de 6 meses': 'Mais de 6 meses',
        'Fase exploratória': 'Fase exploratória',
      },
    },
    lgpdNotice:
      'Autorizo o uso dos dados fornecidos para contato sobre o PLINA-RF. As informações são tratadas com confidencialidade, em conformidade com a LGPD, e não são compartilhadas com terceiros sem consentimento.',
    submitIdle: 'Registrar interesse',
    submitPending: 'Enviando…',
    footerNote:
      'Processo confidencial · Não caracteriza oferta pública · Oferta restrita · Investidor qualificado · CVM 175',
    successPanel: {
      protocolo: 'Protocolo',
      passos: [
        { ordem: '01', titulo: 'Confirmação imediata', detalhe: 'Recebemos seu interesse no PLINA-RF e o registro foi gerado.' },
        { ordem: '02', titulo: 'Em até 48 horas', detalhe: 'Nossa equipe de RI envia apresentação detalhada do instrumento e documentação do FIDC.' },
        { ordem: '03', titulo: 'Roadshow institucional', detalhe: 'Agendamento com o time fundador. Slots em Miami, São Paulo, Cingapura e Londres.' },
      ],
      duvidas: 'Dúvidas?',
    },
  },
  footer: {
    tagline: 'Conectando o crédito brasileiro ao capital global por meio de infraestrutura digital regulada.',
    navegacao: 'Navegação',
    navLinks: {
      produto: 'Produto',
      tese: 'Tese',
      compliance: 'Compliance',
      equipe: 'Equipe',
      registrarInteresse: 'Registrar interesse',
    },
    contato: 'Contato',
    disclaimer:
      'A Plina Finance não é uma corretora. Atua como estruturadora de ativos digitais regulados sob o framework da CVM 175.',
    copyright: '© 2026 Plina Finance. Todos os direitos reservados.',
  },
  consoleFooter: {
    flags: [
      'Plina-RF v1',
      'FIDC CVM 175',
      'Lei 11.795/2008',
      'Auditoria Big Four',
      'Custódia Regulada',
      'Reversibilidade Institucional',
    ],
  },
};
