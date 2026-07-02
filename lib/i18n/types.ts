export type Locale = 'pt-BR' | 'en';

export interface Caminho {
  letra: string;
  titulo: string[];
  duration: string;
  yieldLabel: string;
  mix: string;
  body: string;
}

export interface Principio {
  num: string;
  titulo: string;
  tag: string;
  detalhe: string;
}

export interface Milestone {
  year: string;
  label: string;
}

export interface Especificacao {
  label: string;
  value: string;
  detail: string;
}

export interface Membro {
  operatorId: string;
  nome: string;
  cargo: string;
  bio: string;
}

export interface Dictionary {
  meta: {
    title: string;
    description: string;
    twitterDescription: string;
    keywords: string[];
  };
  siteHeader: {
    skipLink: string;
    nav: { produto: string; tese: string; compliance: string; equipe: string };
    painel: string;
    sair: string;
    registrarInteresse: string;
    menuAbrir: string;
    menuFechar: string;
    languageSwitcher: { pt: string; en: string };
  };
  consoleStrip: {
    aberto: string;
    cta: string;
  };
  hero: {
    linha1: string;
    linha2: string;
    yieldDestaque: string;
    linha3Fim: string;
    subPrefix: string;
    subSuffix: string;
  };
  produto: {
    numMarker: string;
    marker: string;
    titulo: string[];
    intro: string;
    especificacoes: Especificacao[];
  };
  tese: {
    numMarker: string;
    marker: string;
    titulo: string[];
    intro: string;
    tableCaption: string;
    colCaminho: string;
    rowDuration: string;
    rowYield: string;
    rowMix: string;
    rowCurva: string;
    caminhos: Caminho[];
    rodape: string;
  };
  bigStatement: {
    numMarker: string;
    marker: string;
    p1: string;
    p2: string;
    milestones: Milestone[];
  };
  compliance: {
    numMarker: string;
    marker: string;
    titulo: string[];
    intro: string;
    principios: Principio[];
  };
  equipe: {
    numMarker: string;
    marker: string;
    membros: Membro[];
  };
  leadCapture: {
    numMarker: string;
    marker: string;
    headingIdle: string[];
    headingSuccess: string[];
    subIdle: string;
    subSuccess: string;
    fields: {
      nome: string;
      nomePlaceholder: string;
      org: string;
      orgPlaceholder: string;
      email: string;
      emailPlaceholder: string;
      telefone: string;
      telefonePlaceholder: string;
      perfil: string;
      jurisdicao: string;
      jurisdicaoPlaceholder: string;
      ticket: string;
      moeda: string;
      classe: string;
      prazo: string;
      observacoes: string;
      observacoesPlaceholder: string;
      selecione: string;
      selecioneOpcional: string;
    };
    selectOptions: {
      profile: Record<string, string>;
      ticket: Record<string, string>;
      currency: Record<string, string>;
      classe: Record<string, string>;
      timeline: Record<string, string>;
    };
    lgpdNotice: string;
    submitIdle: string;
    submitPending: string;
    footerNote: string;
    successPanel: {
      protocolo: string;
      passos: { ordem: string; titulo: string; detalhe: string }[];
      duvidas: string;
    };
  };
  footer: {
    tagline: string;
    navegacao: string;
    navLinks: { produto: string; tese: string; compliance: string; equipe: string; registrarInteresse: string };
    contato: string;
    disclaimer: string;
    copyright: string;
  };
  consoleFooter: {
    flags: string[];
  };
}
