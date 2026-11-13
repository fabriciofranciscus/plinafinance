import type { Dictionary } from '../types';

/**
 * Textos da landing v2: Norma, `contexto/landing-v2-textos.md` (LD2). Não
 * editar o sentido aqui; mudança de texto volta para a Norma/Consuelo.
 * Títulos em linhas seguem a referência da Íris (SPEC §3).
 */
export const ptBR: Dictionary = {
  meta: {
    title: 'Plina — Liquidez para cotas contempladas de consórcio (em desenvolvimento)',
    description:
      'A Plina está desenvolvendo uma estrutura de liquidez para cotas contempladas de consórcio. Conheça o modelo, o estágio do projeto e os registros em rede de testes.',
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
  landingV2: {
    a11y: {
      pular: 'Pular para o conteúdo',
      inicio: 'Plina, início',
      voltarInicio: 'Plina, voltar ao início',
      navPrincipal: 'Navegação principal',
      resumoAtivo: 'Resumo do ativo',
      menu: 'Menu',
      pausarMovimento: 'Pausar movimento',
      ativarMovimento: 'Retomar movimento',
      idioma: 'Idioma',
    },
    languageSwitcher: { pt: 'PT', en: 'EN' },
    nav: {
      ativo: 'O ativo',
      percurso: 'O percurso',
      estagio: 'Estágio',
      paraQuem: 'Para quem',
      falar: 'Falar com o time',
    },
    hero: {
      kicker: 'Consórcio brasileiro · Em desenvolvimento',
      titulo: ['Cotas contempladas', 'de consórcio, com', 'registro verificável.'],
      sub: 'Uma estrutura em desenvolvimento para conectar o crédito de consórcios brasileiros a novas possibilidades.',
      ctaFalar: 'Falar com o time',
      ctaEstrutura: 'Conhecer a estrutura',
      marca: 'Plina Finance / Brasil',
      estagioRotulo: 'Estágio do projeto',
      estagioValor: 'Modelo em desenvolvimento.',
      estagioLink: 'Conheça o estágio do projeto',
    },
    ativo: {
      numero: '01 / O ativo',
      rotulo: 'PLINA / COTAS CONTEMPLADAS',
      titulo: ['O crédito já existe.', 'O caminho é que muda.'],
      texto:
        'Uma cota contemplada reúne o crédito para comprar um bem e as parcelas que ainda faltam pagar, sob as regras do grupo e da administradora. A Plina está desenvolvendo um modelo para adquirir essas cotas por cessão, com anuência da administradora.',
      link: 'Entenda o percurso',
      card: {
        rotulo: 'ATIVO SUBJACENTE',
        pais: 'BR / CONSÓRCIO',
        titulo: ['Cota', 'contemplada'],
        descricao:
          'Análise da titularidade, das condições de cessão e das possibilidades de realização.',
        origemRotulo: 'Origem',
        origemValor: 'Cessão pelo titular, com anuência da administradora',
      },
    },
    percurso: {
      numero: '02 / O percurso',
      rotulo: 'DA ORIGEM À REALIZAÇÃO',
      titulo: ['Da cota', 'à realização.'],
      intro: 'O modelo prevê que cada cota seja analisada e documentada antes de integrar a operação.',
      notaEtapas: 'Etapas do modelo; assinatura e Pix reais ainda em desenvolvimento.',
      passo1: {
        titulo: 'Analisar.',
        texto: 'Contemplação, titularidade, adimplência e ausência de ônus.',
      },
      passo2: {
        titulo: 'Formalizar.',
        texto:
          'Proposta com deságio, assinatura da cessão, anuência da administradora e pagamento ao titular.',
      },
      passo3: {
        titulo: 'Realizar.',
        texto:
          'Revenda a um comprador aprovado pela administradora, ou recebimento do crédito nas condições do grupo.',
      },
      ressalva: 'Modelo sujeito à análise da cota e à anuência da administradora.',
    },
    estagio: {
      numero: '03 / Estágio',
      rotulo: 'TESTNET → PRÓXIMAS FASES',
      titulo: ['Clareza sobre', 'o estágio.'],
      intro:
        'A tecnologia está sendo demonstrada em ambiente de testes. A operação com dinheiro real e a estrutura de investimento dependem de etapas distintas.',
      demonstrado: {
        rotulo: '01 / DEMONSTRADO',
        titulo: 'Na rede de testes.',
        texto: 'Registros de eventos da cota e uma prova de entrada do investidor na Stellar testnet.',
      },
      desenvolvimento: {
        rotulo: '02 / EM DESENVOLVIMENTO',
        titulo: 'Para operar.',
        texto:
          'Fechamento da cessão, integração de assinatura e Pix, cálculo do NAV e saída pelo produto.',
      },
      futuro: {
        rotulo: '03 / FASE FUTURA',
        titulo: 'Mais adiante.',
        texto:
          'Estrutura institucional prevista para uma fase futura, sujeita a aprovação regulatória e à documentação aplicável. Não há oferta em andamento.',
      },
      nota: 'O registro digital documenta eventos. A validade de cada cessão também depende dos instrumentos jurídicos e da administradora.',
    },
    paraQuem: {
      numero: '04 / Para quem',
      rotulo: 'TRÊS PONTOS DE PARTIDA',
      titulo: ['Uma estrutura.', 'Entradas diferentes.'],
      intro: 'Comece pelo seu papel na operação.',
      instituicoes: {
        titulo: 'Instituições e parceiros',
        texto: 'Conheça a tese, a originação e o estágio do projeto.',
      },
      titular: {
        titulo: 'Titulares de cotas',
        texto:
          'Tem uma cota contemplada e não quer usar o crédito? No modelo, a cessão prevê pagamento com deságio e, aprovada a transferência pela administradora, as parcelas restantes deixam de ser suas. Ainda não compramos cotas: hoje conversamos e analisamos. Não prometemos preço nem prazo.',
      },
      compradores: {
        titulo: 'Compradores e parceiros',
        texto:
          'A revenda a compradores é uma etapa futura do modelo. Se quer acompanhar o desenvolvimento, fale com o time.',
      },
    },
    contato: {
      numero: '05 / Contato',
      titulo: ['Vamos falar', 'sobre o próximo passo.'],
      intro: 'Conte seu objetivo. Sem CPF, documentos ou dados bancários no primeiro contato.',
      email: 'contato@plina.finance',
      aviso: 'Contato exploratório. Esta página não é oferta nem solicitação de investimento.',
      form: {
        titulo: 'Seu contato',
        nome: 'Seu nome *',
        nomePlaceholder: 'Nome',
        nomeErro: 'Informe seu nome.',
        email: 'E-mail *',
        emailPlaceholder: 'voce@empresa.com',
        interesse: 'Interesse *',
        interesseSelecione: 'Selecione o motivo do contato',
        opcoes: {
          tese: 'Conhecer a tese institucional',
          cota: 'Conversar sobre uma cota contemplada',
          parceria: 'Quero propor uma parceria',
          outro: 'Outro assunto',
        },
        organizacao: 'Organização (opcional)',
        organizacaoPlaceholder: 'Empresa ou instituição',
        mensagem: 'Mensagem (opcional)',
        mensagemPlaceholder: 'Como podemos ajudar?',
        preparar: 'Preparar meu contato',
        avisoMailto:
          'Você revisa e envia pelo seu e-mail. Esta página não envia nem armazena o que você digita no formulário.',
      },
      rascunho: {
        titulo: 'Seu contato está pronto.',
        texto:
          'Revise abaixo. A mensagem só será enviada quando você confirmar no seu aplicativo de e-mail.',
        abrir: 'Abrir meu e-mail',
        copiar: 'Copiar mensagem',
        copiado: 'Mensagem copiada. Cole no seu e-mail para contato@plina.finance.',
        selecionado: 'Texto selecionado. Use Ctrl+C ou ⌘C para copiar.',
      },
      semJs:
        'Para entrar em contato, escreva para contato@plina.finance. A preparação de mensagem requer JavaScript.',
      mailto: {
        assunto: 'Contato Plina — {interesse}',
        corpo:
          'Olá, time Plina.\n\nMeu nome é {nome}.\nE-mail para contato: {email}\nInteresse: {interesse}{organizacao}\n\n{mensagem}\n\nObrigado,\n{nome}',
        mensagemPadrao: 'Gostaria de conversar sobre os próximos passos.',
        linhaOrganizacao: '\nOrganização: {organizacao}',
      },
    },
    footer: {
      tagline: ['Cotas contempladas de consórcio,', 'com registro verificável em rede de testes.'],
      conheca: 'Conheça',
      converse: 'Converse',
      transparencia: 'Transparência',
      copyright: ['© 2026 Plina Finance.', 'Registros em rede de testes.'],
      linkTestnet: 'Ver registros na rede de testes',
      aviso:
        'Esta página apresenta a tese e o modelo em desenvolvimento da Plina. Não constitui oferta de valores mobiliários, promessa de rentabilidade ou garantia de liquidez. Uma estrutura institucional é planejada para fase futura, sujeita à sua constituição e à documentação aplicável.',
    },
  },
};
