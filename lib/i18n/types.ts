export type Locale = 'pt-BR' | 'en';

/** Item de "Estágio" (seção 03). */
export interface EstagioItem {
  rotulo: string;
  titulo: string;
  texto: string;
}

/** Etapa do percurso (seção 02). */
export interface PassoItem {
  titulo: string;
  texto: string;
}

/** Linha de "Para quem" (seção 04). */
export interface PublicoItem {
  titulo: string;
  texto: string;
}

/** Interesses do formulário; o valor é o que a linha de "Para quem" pré-seleciona. */
export type InteresseId = 'tese' | 'cota' | 'parceria' | 'outro';

/**
 * Landing v2 (LD3). Chaves = tabela da Norma em
 * `contexto/landing-v2-textos.md`; títulos são listas de linhas (cada linha
 * é um bloco, ver SPEC §3) e a Norma passa a revisar o texto por linha.
 */
export interface LandingV2 {
  a11y: {
    pular: string;
    inicio: string;
    voltarInicio: string;
    navPrincipal: string;
    resumoAtivo: string;
    menu: string;
    pausarMovimento: string;
    /** Rótulo do botão quando o movimento está pausado (não consta na tabela da Norma). */
    ativarMovimento: string;
    /** Nome acessível do seletor de idioma (não consta na tabela da Norma). */
    idioma: string;
  };
  languageSwitcher: { pt: string; en: string };
  nav: {
    ativo: string;
    percurso: string;
    estagio: string;
    paraQuem: string;
    falar: string;
  };
  hero: {
    kicker: string;
    titulo: string[];
    sub: string;
    ctaFalar: string;
    ctaEstrutura: string;
    marca: string;
    estagioRotulo: string;
    estagioValor: string;
    estagioLink: string;
  };
  ativo: {
    numero: string;
    rotulo: string;
    titulo: string[];
    texto: string;
    link: string;
    card: {
      rotulo: string;
      pais: string;
      titulo: string[];
      descricao: string;
      origemRotulo: string;
      origemValor: string;
    };
  };
  percurso: {
    numero: string;
    rotulo: string;
    titulo: string[];
    intro: string;
    notaEtapas: string;
    passo1: PassoItem;
    passo2: PassoItem;
    passo3: PassoItem;
    ressalva: string;
  };
  estagio: {
    numero: string;
    rotulo: string;
    titulo: string[];
    intro: string;
    demonstrado: EstagioItem;
    desenvolvimento: EstagioItem;
    futuro: EstagioItem;
    nota: string;
  };
  paraQuem: {
    numero: string;
    rotulo: string;
    titulo: string[];
    intro: string;
    instituicoes: PublicoItem;
    titular: PublicoItem;
    compradores: PublicoItem;
  };
  contato: {
    numero: string;
    titulo: string[];
    intro: string;
    email: string;
    aviso: string;
    form: {
      titulo: string;
      nome: string;
      nomePlaceholder: string;
      nomeErro: string;
      email: string;
      emailPlaceholder: string;
      interesse: string;
      interesseSelecione: string;
      opcoes: Record<InteresseId, string>;
      organizacao: string;
      organizacaoPlaceholder: string;
      mensagem: string;
      mensagemPlaceholder: string;
      preparar: string;
      avisoMailto: string;
    };
    rascunho: {
      titulo: string;
      texto: string;
      abrir: string;
      copiar: string;
      copiado: string;
      selecionado: string;
    };
    semJs: string;
    mailto: {
      /** `{interesse}` */
      assunto: string;
      /** `{nome}`, `{email}`, `{interesse}`, `{organizacao}`, `{mensagem}` */
      corpo: string;
      mensagemPadrao: string;
      /** Entra no lugar de `{organizacao}` só se preenchida; `{organizacao}` = valor. */
      linhaOrganizacao: string;
    };
  };
  footer: {
    /** Linhas do bloco de marca. */
    tagline: string[];
    conheca: string;
    converse: string;
    transparencia: string;
    /** Linhas: direitos e registros. */
    copyright: string[];
    linkTestnet: string;
    aviso: string;
    /** Rótulo do link para /privacidade. */
    privacidade: string;
  };
}

/** Página /privacidade (LV9, versão base da Norma; substituída pela /lgpd completa no LD4a). */
export interface Privacidade {
  title: string;
  metaDescription: string;
  versao: string;
  estagio: string;
  quem: { titulo: string; texto: string };
  medicao: { titulo: string; texto: string; base: string };
  idioma: { titulo: string; texto: string };
  contato: { titulo: string; texto: string };
  app: { titulo: string; texto: string };
  naoUsamos: string;
  internacional: { titulo: string; texto: string };
  direitos: { titulo: string; texto: string };
  mudancas: string;
}

export interface Dictionary {
  /** Metadados do documento (title/description vêm da Norma, LD2). */
  meta: {
    title: string;
    description: string;
    twitterDescription: string;
    keywords: string[];
  };
  landingV2: LandingV2;
  privacidade: Privacidade;
}
