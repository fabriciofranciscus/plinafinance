import type { Dictionary } from '../types';

/**
 * Landing v2 texts: Norma, `contexto/landing-v2-textos.md` (LD2), domain
 * review by Consuelo. Do not change the meaning here; copy changes go back to
 * Norma/Consuelo. Title lines follow the Íris reference (SPEC §3).
 */
export const en: Dictionary = {
  meta: {
    title: 'Plina — Liquidity for awarded consortium quotas (under development)',
    description:
      'Plina is developing a liquidity structure for awarded consortium quotas. Learn about the model, the project stage and the records on a test network. This is not an offer.',
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
  landingV2: {
    a11y: {
      pular: 'Skip to content',
      inicio: 'Plina, home',
      voltarInicio: 'Plina, back to top',
      navPrincipal: 'Main navigation',
      resumoAtivo: 'Asset summary',
      menu: 'Menu',
      pausarMovimento: 'Pause motion',
      ativarMovimento: 'Resume motion',
      idioma: 'Language',
    },
    languageSwitcher: { pt: 'PT', en: 'EN' },
    nav: {
      ativo: 'The asset',
      percurso: 'The path',
      estagio: 'Stage',
      paraQuem: 'For whom',
      falar: 'Talk to the team',
    },
    hero: {
      kicker: 'Brazilian consortium · Under development',
      titulo: ['Awarded consortium', 'quotas, with a', 'verifiable record.'],
      sub: 'A structure under development to connect Brazilian consortium credit to new possibilities.',
      ctaFalar: 'Talk to the team',
      ctaEstrutura: 'Explore the structure',
      marca: 'Plina Finance / Brazil',
      estagioRotulo: 'Project stage',
      estagioValor: 'Model under development.',
      estagioLink: 'See the project stage',
    },
    ativo: {
      numero: '01 / The asset',
      rotulo: 'PLINA / AWARDED QUOTAS',
      titulo: ['The credit already exists.', 'What changes', 'is the path.'],
      texto:
        "In a Brazilian consórcio (a pooled purchasing group), an awarded quota combines the credit to buy an asset with the installments still to be paid, under the rules of the group and the consortium administrator. Plina is developing a model to acquire these quotas by assignment, with the administrator's prior consent.",
      link: 'See the path',
      card: {
        rotulo: 'UNDERLYING ASSET',
        pais: 'BR / CONSORTIUM',
        titulo: ['Awarded', 'quota'],
        descricao: 'Review of ownership, assignment conditions and realization possibilities.',
        origemRotulo: 'Origin',
        origemValor: "Assignment by the holder, with the administrator's consent",
      },
    },
    percurso: {
      numero: '02 / The path',
      rotulo: 'FROM ORIGIN TO REALIZATION',
      titulo: ['From quota', 'to realization.'],
      intro: 'The model provides that each quota is reviewed and documented before entering the operation.',
      notaEtapas: 'Steps of the model; real signing and Pix payments are still under development.',
      passo1: {
        titulo: 'Review.',
        texto: 'Award status, ownership, payments up to date and no liens or encumbrances.',
      },
      passo2: {
        titulo: 'Formalize.',
        texto:
          "Proposal at a discount, signing of the assignment, the administrator's consent and payment to the holder.",
      },
      passo3: {
        titulo: 'Realize.',
        texto:
          "Resale to a buyer approved by the administrator, or receipt of the credit on the group's terms.",
      },
      ressalva: "Model subject to review of the quota and to the administrator's consent.",
    },
    estagio: {
      numero: '03 / Stage',
      rotulo: 'TESTNET → NEXT PHASES',
      titulo: ['Clarity about', 'the stage.'],
      intro:
        'The technology is being demonstrated in a test environment. Operating with real money and any investment structure depend on separate steps.',
      demonstrado: {
        rotulo: '01 / DEMONSTRATED',
        titulo: 'On the test network.',
        texto: 'Records of quota events and a proof of investor entry on Stellar testnet.',
      },
      desenvolvimento: {
        rotulo: '02 / UNDER DEVELOPMENT',
        titulo: 'To operate.',
        texto:
          'Closing of the assignment, signing and Pix integration, NAV calculation and the investor exit flow.',
      },
      futuro: {
        rotulo: '03 / FUTURE PHASE',
        titulo: 'Further ahead.',
        texto:
          'An institutional structure is foreseen for a future phase, subject to regulatory approval and applicable documentation. No offer is under way.',
      },
      nota: 'The digital record documents events. The validity of each assignment also depends on the legal instruments and on the administrator.',
    },
    paraQuem: {
      numero: '04 / For whom',
      rotulo: 'THREE STARTING POINTS',
      titulo: ['One structure.', 'Different entry points.'],
      intro: 'Start with your role in the operation.',
      instituicoes: {
        titulo: 'Institutions and partners',
        texto: 'Learn about the thesis, the origination and the project stage.',
      },
      titular: {
        titulo: 'Quota holders',
        texto:
          'Do you hold an awarded quota and do not want to use the credit? In the model, the assignment provides for payment at a discount to the credit amount and, once the administrator approves the transfer, the remaining installments are no longer your obligation. We do not buy quotas yet: today we talk and review. No price or timeline is promised.',
      },
      compradores: {
        titulo: 'Buyers and partners',
        texto:
          'Resale to buyers is a future step of the model. If you want to follow the development, talk to the team.',
      },
    },
    contato: {
      numero: '05 / Contact',
      titulo: ["Let's talk", 'about the next step.'],
      intro: 'Tell us your goal. No tax ID, documents or bank details in the first contact.',
      email: 'contato@plina.finance',
      aviso: 'Exploratory contact. This page is not an offer or a solicitation of investment.',
      form: {
        titulo: 'Your message',
        nome: 'Your name *',
        nomePlaceholder: 'Name',
        nomeErro: 'Enter your name.',
        email: 'E-mail *',
        emailPlaceholder: 'you@company.com',
        interesse: 'Interest *',
        interesseSelecione: 'Select the reason for contact',
        opcoes: {
          tese: 'Learn about the institutional thesis',
          cota: 'Talk about an awarded quota',
          parceria: 'I want to propose a partnership',
          outro: 'Another subject',
        },
        organizacao: 'Organization (optional)',
        organizacaoPlaceholder: 'Company or institution',
        mensagem: 'Message (optional)',
        mensagemPlaceholder: 'How can we help?',
        preparar: 'Prepare my message',
        avisoMailto:
          'You review and send it from your own e-mail. This page does not send or store what you type in the form.',
      },
      rascunho: {
        titulo: 'Your message is ready.',
        texto:
          'Review it below. The message is sent only when you confirm in your e-mail app.',
        abrir: 'Open my e-mail',
        copiar: 'Copy message',
        copiado: 'Message copied. Paste it into your e-mail to contato@plina.finance.',
        selecionado: 'Text selected. Use Ctrl+C or ⌘C to copy.',
      },
      semJs:
        'To get in touch, write to contato@plina.finance. Preparing the message requires JavaScript.',
      mailto: {
        assunto: 'Plina contact — {interesse}',
        corpo:
          'Hello, Plina team.\n\nMy name is {nome}.\nContact e-mail: {email}\nInterest: {interesse}{organizacao}\n\n{mensagem}\n\nThank you,\n{nome}',
        mensagemPadrao: 'I would like to talk about next steps.',
        linhaOrganizacao: '\nOrganization: {organizacao}',
      },
    },
    footer: {
      tagline: ['Awarded consortium quotas,', 'with verifiable records on a test network.'],
      conheca: 'Explore',
      converse: 'Get in touch',
      transparencia: 'Transparency',
      copyright: ['© 2026 Plina Finance.', 'Records on a test network.'],
      linkTestnet: 'View records on the test network',
      aviso:
        "This page presents Plina's thesis and the model under development. It is not an offer of securities, a promise of returns or a guarantee of liquidity. An institutional structure is planned for a future phase, subject to its formation and applicable documentation.",
      privacidade: 'Privacy',
    },
  },
  privacidade: {
    title: 'Privacy of this site',
    metaDescription: 'How this site handles personal data: anonymous visit measurement, a language cookie and an e-mail contact form.',
    versao: 'Base version · 13 November 2026',
    estagio: 'This site presents a project under development, on a test network. There is no offer of any financial product.',
    quem: { titulo: 'Who handles your data', texto: 'Plina Finance (a project in its testing phase, company being incorporated) is the controller of the data described here. For any privacy matter, write to contato@plina.finance.' },
    medicao: { titulo: 'Audience and performance measurement', texto: 'We use Vercel Web Analytics and Vercel Speed Insights. On each visit they record the page visited, where the visit came from, approximate city and country, device type and browser, and performance metrics. They do not use third-party cookies and do not identify you by name or e-mail; the visit session is discarded within 24 hours. We strip any query string and fragment from the URL before sending. Vercel acts as processor of this data.', base: 'Legal basis: legitimate interest, to understand how the site is used and how it performs.' },
    idioma: { titulo: 'Language cookie', texto: 'We store a functional cookie with the language you chose (Portuguese or English). It stores only that choice.' },
    contato: { titulo: 'Contact by e-mail', texto: 'The form on this site does not send or store what you type: it prepares a message that you send from your own e-mail app to contato@plina.finance. When you send it, the e-mail reaches Plina; we use the data only to reply to you and keep it for as long as needed for that.' },
    app: { titulo: 'Test application', texto: 'The Plina application (sign-in, sell, buy and pool-entry simulation pages) runs on a test network, with no real financial value. We ask that you use only fictitious or test data. If you enter personal data, it is used only to run the demonstration (sign-in, test registration and test identity verification) and is held by hosting, database, sign-in, identity-verification and e-signature providers engaged by Plina, in a test environment. Personal data does not go onto the blockchain: only hashes, addresses and timestamps. We do not use this data for any other purpose.' },
    naoUsamos: 'We do not use advertising cookies or cross-site tracking.',
    internacional: { titulo: 'International transfer', texto: 'Providers such as Vercel may process data outside Brazil. We apply the safeguards provided for by Brazilian data protection law for this transfer.' },
    direitos: { titulo: 'Your rights', texto: 'Brazilian data protection law (LGPD, art. 18) gives you, among other rights, the right to ask for confirmation of processing, access, correction, deletion of unnecessary data, information about sharing and withdrawal of consent. To exercise them, write to contato@plina.finance. You may also complain to the Brazilian data protection authority (ANPD).' },
    mudancas: 'This policy will be updated when the company is incorporated and the data protection officer is appointed. When this page changes, we will publish the new version and date here.',
  },
};
