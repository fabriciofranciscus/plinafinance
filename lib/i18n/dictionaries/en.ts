import type { Dictionary } from '../types';

export const en: Dictionary = {
  meta: {
    title: 'Plina',
    description:
      'Plina is developing a structure for awarded consortium quotas, with verifiable records on a test network. Not an investment offer.',
    twitterDescription:
      'Awarded consortium quotas, with verifiable records on a test network. Under development.',
    keywords: [
      'awarded consortium quotas',
      'consortium',
      'Stellar',
      'verifiable record',
      'test network',
    ],
  },
  siteHeader: {
    skipLink: 'Skip to content',
    nav: {
      produto: 'Model',
      tese: 'Thesis',
      compliance: 'Compliance',
      equipe: 'Team',
    },
    painel: 'Dashboard',
    sair: 'Sign out',
    registrarInteresse: 'Talk to the team',
    menuAbrir: 'Open menu',
    menuFechar: 'Close menu',
    languageSwitcher: { pt: 'PT', en: 'EN' },
  },
  consoleStrip: {
    aberto: 'Under development · Test network · No offer under way',
    cta: 'Talk to the team →',
  },
  hero: {
    linha1: 'Awarded consortium quotas.',
    linha2: 'Verifiable record.',
    destaque: 'Under development,',
    linha3Fim: 'on a test network.',
    sub: 'We are developing the origination of awarded consortium quotas, with verifiable records on Stellar testnet. This page is not an offer or a solicitation of investment.',
  },
  produto: {
    numMarker: '01',
    marker: 'Model',
    titulo: ['Structure', ' in testing', '.'],
    intro:
      "We are developing the origination of awarded consortium quotas, with a digital record of each quota's events. Plina is not a broker. This page is not an offer or a solicitation of investment.",
    especificacoes: [
      {
        label: 'Asset',
        value: 'Awarded consortium quota',
        detail: "A credit right subject to the group's rules and the administrator's consent.",
      },
      {
        label: 'Stage',
        value: 'Test network',
        detail:
          'An institutional structure is planned for a future phase, subject to regulatory approval and applicable documentation.',
      },
      {
        label: 'Record',
        value: 'Digital, on testnet',
        detail: 'Each quota event leaves a verifiable record on Stellar testnet.',
      },
      {
        label: 'Contact',
        value: 'Exploratory',
        detail: 'No investment offer under way.',
      },
    ],
  },
  tese: {
    numMarker: '02',
    marker: 'Thesis',
    titulo: ['Three paths.', 'One model.'],
    intro:
      "The model foresees three realization paths, according to each group's and administrator's rules. Everything here is under development.",
    tableCaption: 'The three realization paths foreseen in the model',
    colCaminho: 'Path',
    rowDuration: 'Term',
    rowEstagio: 'Stage',
    rowMix: 'Weight in the model',
    caminhos: [
      {
        letra: 'A',
        titulo: ['Resale to the', 'End Buyer'],
        duration: 'To be defined',
        estagio: 'Under development',
        mix: 'To be defined',
        body: 'The model foresees resale of the quota to a buyer approved by the administrator. This channel is not yet operating.',
      },
      {
        letra: 'B',
        titulo: ['Settlement by', 'Administrator'],
        duration: 'Per the administrator',
        estagio: 'Under development',
        mix: 'To be defined',
        body: 'For eligible quotas, the administrator may convert the award into a cash payment, under the applicable regulation. A path foreseen in the model, still under development.',
      },
      {
        letra: 'C',
        titulo: ['Settlement at', 'Group Term'],
        duration: "Per the group's term",
        estagio: 'Under development',
        mix: 'To be defined',
        body: "For quotas not realized through paths A or B, the credit is realized at the end of the group's term, on contractual terms. No guarantee of term or amount.",
      },
    ],
    rodape:
      'No composition, term or result is defined or guaranteed. The model is under development.',
  },
  bigStatement: {
    numMarker: '03',
    marker: 'Regulatory Milestone',
    p1: 'Law 11.795 regulated the Brazilian consortium market in 2008. For nearly two decades the credit right on awarded quotas has been legally constituted. Plina is studying new realization paths for it.',
    p2: 'Plina is developing the origination of these quotas, with verifiable records on a test network.',
    milestones: [
      { year: '2008', label: 'Law 11.795 regulates Brazilian consortiums' },
      { year: '2026', label: 'Plina · records on a test network' },
      { year: 'Later', label: 'Next phases, subject to regulatory approval' },
    ],
  },
  compliance: {
    numMarker: '04',
    marker: 'Compliance',
    titulo: ['Compliance', 'by design.'],
    intro:
      'Reversibility and traceability are requirements of any regulated structure. Plina treats them as a design requirement from the start.',
    principios: [
      {
        num: '01',
        titulo: 'Auditable',
        tag: 'Verifiable · Test network',
        detalhe:
          'In the model, each quota event generates a verifiable digital record. Today, on a test network.',
      },
      {
        num: '02',
        titulo: 'Legal basis',
        tag: 'Law 11.795/2008',
        detalhe:
          'The model starts from Law 11.795/2008 on consortiums. An institutional structure is planned for a future phase, subject to regulatory approval.',
      },
      {
        num: '03',
        titulo: 'Reversible',
        tag: 'Clawback · Authorization · Revocability',
        detalhe:
          'Public clawback policy, restricted to four explicit legal grounds. Institutional reversibility as a competitive advantage, not a technical limitation.',
      },
    ],
  },
  equipe: {
    numMarker: '05',
    marker: 'Founding Team',
    membros: [
      {
        operatorId: '01',
        nome: 'Fabrício Santos',
        cargo: 'CEO & Founder',
        bio: 'Founding partner of Citrino, a financial planning and wealth management advisory. Worked on revenue, cost, and customer experience strategy at the digital credit platform Simplic, and led the implementation of the corporate KPI system for the Board and Executive Committee at TOTVS.',
      },
      {
        operatorId: '02',
        nome: 'Thais Reis',
        cargo: 'CTO & Protocol Lead',
        bio: 'Full-stack engineer with five years in blockchain infrastructure — data engineering, backend, automated contracts in Rust, and React/TypeScript interfaces. Founder and Lead Engineer of the Karn Ecosystem, an open-source governance platform. Award winner in national and international decentralized technology and artificial intelligence competitions.',
      },
    ],
  },
  leadCapture: {
    numMarker: '06',
    marker: 'Contact',
    headingIdle: ['Talk to', 'the team.'],
    headingSuccess: ['Contact', 'received.'],
    subIdle:
      'Fill in the fields below to talk to the Plina team. Exploratory contact: this page is not an offer or a solicitation of investment.',
    subSuccess: 'We received your message. Our team will reply by e-mail.',
    fields: {
      nome: 'Full name *',
      nomePlaceholder: 'First and last name',
      org: 'Organization *',
      orgPlaceholder: 'Family office, asset manager, fund...',
      email: 'Corporate email *',
      emailPlaceholder: 'name@organization.com',
      telefone: 'Phone / WhatsApp',
      telefonePlaceholder: '+1 555 999-9999',
      perfil: 'Profile *',
      jurisdicao: 'Primary jurisdiction',
      jurisdicaoPlaceholder: 'Brazil, USA, Singapore...',
      observacoes: 'Notes / questions',
      observacoesPlaceholder: 'Compliance restrictions, specific structuring requirements, initial questions...',
      selecione: 'Select',
    },
    selectOptions: {
      profile: {
        'family-office-br': 'Brazilian family office',
        'family-office-int': 'International family office',
        'gestora-br': 'Asset manager (Brazil)',
        'gestora-int': 'Multi-market asset manager (International)',
        'fintech-latam': 'LATAM investment fintech',
        outro: 'Other — describe in the notes',
      },
    },
    lgpdNotice:
      'I authorize Plina Finance to use the data in this form to reply to this contact. It is held by e-mail and hosting providers engaged by Plina, kept for as long as needed to reply, and not used for any other purpose. To request access, correction or deletion, write to contato@plina.finance.',
    submitIdle: 'Send message',
    submitPending: 'Sending…',
    footerNote:
      'Exploratory contact · This page is not an offer or a solicitation of investment · Under development',
    successPanel: {
      protocolo: 'Protocol',
      passos: [
        { ordem: '01', titulo: 'Immediate confirmation', detalhe: 'We received your message and a record was created.' },
        {
          ordem: '02',
          titulo: 'Reply',
          detalhe: 'Our team replies by e-mail. There is no offering documentation: no offer is under way.',
        },
        {
          ordem: '03',
          titulo: 'Conversation with the team',
          detalhe: 'If it makes sense, we schedule a conversation with the founding team.',
        },
      ],
      duvidas: 'Questions?',
    },
  },
  footer: {
    tagline: 'Awarded consortium quotas, with verifiable records on a test network.',
    navegacao: 'Navigation',
    navLinks: {
      produto: 'Model',
      tese: 'Thesis',
      compliance: 'Compliance',
      equipe: 'Team',
      registrarInteresse: 'Talk to the team',
    },
    contato: 'Contact',
    disclaimer:
      'Plina Finance is not a broker. This page presents a model under development, on a test network. It is not an offer of securities, a promise of returns or a guarantee of liquidity. An institutional structure is planned for a future phase, subject to regulatory approval and applicable documentation.',
    copyright: '© 2026 Plina Finance. All rights reserved.',
  },
  consoleFooter: {
    flags: ['Testnet', 'Under development', 'Law 11.795/2008', 'No offer under way'],
  },
};
