import type { Dictionary } from '../types';

export const en: Dictionary = {
  meta: {
    title: 'Plina',
    description:
      'Connecting global capital to Brazilian credit rights. PLINA-RF: an institutional token backed by an FIDC under CVM 175, distributed on Stellar.',
    twitterDescription:
      'Connecting global capital to Brazilian credit rights via Stellar. FIDC under CVM 175.',
    keywords: [
      'institutional tokenization',
      'credit rights',
      'FIDC',
      'CVM 175',
      'Stellar',
      'RWA',
      'awarded consortium quota',
      'PLINA-RF',
    ],
  },
  siteHeader: {
    skipLink: 'Skip to content',
    nav: {
      produto: 'Product',
      tese: 'Thesis',
      compliance: 'Compliance',
      equipe: 'Team',
    },
    painel: 'Dashboard',
    sair: 'Sign out',
    registrarInteresse: 'Register interest',
    menuAbrir: 'Open menu',
    menuFechar: 'Close menu',
    languageSwitcher: { pt: 'PT', en: 'EN' },
  },
  consoleStrip: {
    aberto: 'Open for qualified institutional investors',
    cta: 'Register interest →',
  },
  hero: {
    linha1: 'Liquidity for the quota holder.',
    linha2: 'Discount for the buyer.',
    yieldDestaque: 'Institutional yield',
    linha3Fim: 'for the world.',
    subPrefix: 'A tokenized pool of awarded consortium quotas, structured as an FIDC under CVM 175 and issued on Stellar as',
    subSuffix: '.',
  },
  produto: {
    numMarker: '01',
    marker: 'Product',
    titulo: ['PLINA', '-RF', '.'],
    intro:
      'An FIDC quota represented by a regulated digital instrument, issued under CVM 175. Not a broker. Not an open retail fund. It is the tokenized financial instrument itself, with origination, regulated custody, and compliance controls built in.',
    especificacoes: [
      {
        label: 'Backing',
        value: '1 PLINA-RF = R$ 1.00',
        detail: 'Backed by credit rights, with value adjusted daily.',
      },
      {
        label: 'Vehicle',
        value: 'FIDC · CVM 175',
        detail: 'Senior and subordinated classes, registered service providers, Big Four audit.',
      },
      {
        label: 'Custody',
        value: 'Regulated custodian',
        detail: 'Auditable digital record with institutional blocking, authorization, and reversibility.',
      },
      {
        label: 'Investment',
        value: 'USD · EUR · BRL',
        detail: 'International and domestic investors, settled in USDC, EURC, and local currency.',
      },
    ],
  },
  tese: {
    numMarker: '02',
    marker: 'Thesis',
    titulo: ['Three paths.', 'One pool.'],
    intro:
      'A hybrid model for realizing value. Actively managed by the FIDC manager and audited quarterly. This is where Plina builds a durable competitive edge over incumbents restricted to Path B.',
    tableCaption:
      'Comparison of the three value-realization paths — duration, yield, target mix, and projected curve',
    colCaminho: 'Path',
    rowDuration: 'Duration',
    rowYield: 'Yield',
    rowMix: 'Target Mix',
    rowCurva: 'Projected curve',
    caminhos: [
      {
        letra: 'A',
        titulo: ['Resale to the', 'End Buyer'],
        duration: '30-90 days',
        yieldLabel: 'High',
        mix: '40-60%',
        body: 'The difference between the price paid to the original seller and the price charged to the end buyer of the asset is the primary source of yield. We run a dedicated commercial channel to resell quotas to whoever will actually use the credit letter — an individual, a builder, a hauler, a business owner.',
      },
      {
        letra: 'B',
        titulo: ['Settlement by', 'Administrator'],
        duration: '90-180 days',
        yieldLabel: 'Medium',
        mix: '30-50%',
        body: 'For quotas eligible under BACEN Circular 3.432/2009, the administrator converts the award into a cash payment within 180 days. The predominant path for incumbents — operated by Plina within the formal FIDC structure, with no gray-zone regulatory exposure.',
      },
      {
        letra: 'C',
        titulo: ['Settlement at', 'Group Term'],
        duration: '12-36 months',
        yieldLabel: 'Contracted',
        mix: '10-20%',
        body: 'For quotas not realized through paths A or B, the credit right is realized at the end of the BACEN-regulated term with contractual monetary correction. Serves as the technical reserve and yield floor of the pool.',
      },
    ],
    rodape:
      'Initial target composition documented in the FIDC regulation. Mix continuously adjusted by the manager based on market conditions.',
  },
  bigStatement: {
    numMarker: '03',
    marker: 'Regulatory Milestone',
    p1: 'Law 11.795 regulated the Brazilian consortium market in 2008. For nearly two decades, the credit right on awarded quotas has been legally constituted, yet it never reached global institutional capital.',
    p2: 'Plina is the first institutional tokenizer under CVM 175 from inception.',
    milestones: [
      { year: '2008', label: 'Law 11.795 regulates Brazilian consortiums' },
      { year: '2023', label: 'CVM 175 structures institutional tokenization' },
      { year: '2026', label: 'Plina · first tokenizer of consortium credit rights' },
    ],
  },
  compliance: {
    numMarker: '04',
    marker: 'Compliance',
    titulo: ['Native', 'compliance.'],
    intro:
      'For an institutional risk desk, reversibility is not a limitation. It is a requirement. Family offices and regulated managers do not allocate to a digital asset without a formal blocking and recovery mechanism. Without it, the product does not pass compliance.',
    principios: [
      {
        num: '01',
        titulo: 'Auditable',
        tag: 'Publicly verifiable · Immutable record',
        detalhe:
          'Every quota incorporated into the pool has a publicly verifiable digital record, with formal and immutable legal backing.',
      },
      {
        num: '02',
        titulo: 'Regulated',
        tag: 'CVM 175 · Law 11.795/2008',
        detalhe:
          'CVM 175 and Law 11.795/2008 from inception. Formal FIDC, registered service providers, Big Four audit.',
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
    marker: 'Onboarding',
    headingIdle: ['Register your', 'interest.'],
    headingSuccess: ['Interest', 'registered.'],
    subIdle:
      'Fill in the fields below to express interest in PLINA-RF. Our team will reach out within 48 hours with a detailed presentation of the instrument.',
    subSuccess:
      'Our team will reach out within 48 hours with a detailed presentation of the instrument and the FIDC documentation.',
    fields: {
      nome: 'Full name *',
      nomePlaceholder: 'First and last name',
      org: 'Organization *',
      orgPlaceholder: 'Family office, asset manager, fund...',
      email: 'Corporate email *',
      emailPlaceholder: 'name@organization.com',
      telefone: 'Phone / WhatsApp',
      telefonePlaceholder: '+1 555 999-9999',
      perfil: 'Investor profile *',
      jurisdicao: 'Primary jurisdiction',
      jurisdicaoPlaceholder: 'Brazil, USA, Singapore...',
      ticket: 'Indicative ticket *',
      moeda: 'Preferred currency',
      classe: 'Class of interest',
      prazo: 'Decision timeline',
      observacoes: 'Notes / questions',
      observacoesPlaceholder: 'Compliance restrictions, specific structuring requirements, initial questions...',
      selecione: 'Select',
      selecioneOpcional: 'Select (optional)',
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
        'Ainda indefinido': 'Still undecided',
      },
      classe: {
        Sênior: 'Senior (lower risk, priority return)',
        Subordinada: 'Subordinated (first-loss, higher potential return)',
        Ambas: 'Both — subject to modeling',
        Indefinido: 'Undecided',
      },
      timeline: {
        'Até 30 dias': 'Within 30 days',
        '1 a 3 meses': '1 to 3 months',
        '3 a 6 meses': '3 to 6 months',
        'Mais de 6 meses': 'More than 6 months',
        'Fase exploratória': 'Exploratory phase',
      },
    },
    lgpdNotice:
      'I authorize the use of the information provided to be contacted about PLINA-RF. This information is handled confidentially, in compliance with LGPD (Brazilian data protection law), and is not shared with third parties without consent.',
    submitIdle: 'Register interest',
    submitPending: 'Sending…',
    footerNote:
      'Confidential process · Does not constitute a public offering · Restricted offer · Qualified investor · CVM 175',
    successPanel: {
      protocolo: 'Protocol',
      passos: [
        { ordem: '01', titulo: 'Immediate confirmation', detalhe: 'We received your interest in PLINA-RF and the record has been created.' },
        { ordem: '02', titulo: 'Within 48 hours', detalhe: 'Our IR team sends a detailed presentation of the instrument and the FIDC documentation.' },
        { ordem: '03', titulo: 'Institutional roadshow', detalhe: 'Scheduling with the founding team. Slots in Miami, São Paulo, Singapore, and London.' },
      ],
      duvidas: 'Questions?',
    },
  },
  footer: {
    tagline: 'Connecting Brazilian credit to global capital through regulated digital infrastructure.',
    navegacao: 'Navigation',
    navLinks: {
      produto: 'Product',
      tese: 'Thesis',
      compliance: 'Compliance',
      equipe: 'Team',
      registrarInteresse: 'Register interest',
    },
    contato: 'Contact',
    disclaimer:
      'Plina Finance is not a broker. It acts as a structurer of regulated digital assets under the CVM 175 framework.',
    copyright: '© 2026 Plina Finance. All rights reserved.',
  },
  consoleFooter: {
    flags: [
      'Plina-RF v1',
      'FIDC CVM 175',
      'Law 11.795/2008',
      'Big Four Audit',
      'Regulated Custody',
      'Institutional Reversibility',
    ],
  },
};
