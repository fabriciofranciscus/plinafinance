# Plina Finance — Design System v1.2

Regulated Terminal · revisão visual de 17/11/2026, a partir do briefing do Atlas e do feedback da Thais.
Documento autoritativo de aparência; valores em `tokens.json`, exportações em `tokens.css` e `tailwind-v4.css`, resumo em `PROMPT.md`.

## 0. Como usar

Esta versão substitui a v1.1. As regras antigas de raio binário, sombra única e uppercase obrigatório em todo label deixam de valer. A atualização é de apresentação: não autoriza mudar APIs, autorização, cálculos, texto aprovado ou estados de negócio.

Precedência visual: este documento → valores de `tokens.json` → guidelines históricos → `DESIGN.md`. Instruções atuais da Thais prevalecem. Produto, fase regulatória e invariantes vêm dos documentos de domínio; a identidade visual não prova enquadramento, disponibilidade ou aprovação jurídica.

## 1. Direção e públicos

Autoridade técnica, precisão e auditabilidade, com leitura leve e hierarquia explícita. Chillax assina os títulos; números em Geist Mono; superfícies neutras e ciano raro. A fluidez aparece nos contornos e nas transições, sem tornar o app uma fintech de varejo.

- Institucional: composição editorial, documentação e provas em destaque.
- Admin: informação comparável, ações contextualizadas, espaço para trabalhar.
- Cedente e comprador: uma decisão por etapa, baixa fricção e contexto persistente.
- Investidor: valores e estado real antes das ações; condições e evidências junto da decisão.

Não transformar intenções do roadmap em fatos de interface. Reutilizar a copy aprovada da tela; N2–N6 e demais pendências jurídicas continuam bloqueadas.

## 2. Oito leis

1. **Um sinal.** Ciano em até 10% do viewport e até três pontos de destaque. Foco visível nunca é suprimido para cumprir esse orçamento.
2. **Superfícies por função.** Branco para ler/agir, cinza para agrupar, petróleo para contraste editorial ou navegação. Uma tela pode usar só duas; não alternar fundos mecanicamente.
3. **Contraste por superfície.** Escolher ciano e foco conforme §3. Hierarquia nunca depende de tornar texto ilegível.
4. **Flat em repouso, elevação com propósito.** Três níveis no §6; sombra não enfeita todo bloco.
5. **Contorno por função.** 0 em dados tabulares, 12 px em cartões, 16 px em painéis/imagens, pill nos controles de uma linha.
6. **Números em mono.** Valores, prazos, quantidades, identificadores e provas têm leitura estável e alinhamento comparável.
7. **Hierarquia antes da cor.** Título, valor decisivo, conteúdo e metadados têm papéis diferentes. Não aumentar todos ao mesmo tempo.
8. **Movimento explica uma mudança.** Resposta ao gesto, abertura e transição de conteúdo; sem atrasar uma ação ou sugerir sucesso não confirmado.

## 3. Cor e contraste

Paleta preservada. Não há nova cor de marca nem quarto fundo de conteúdo.

| Papel | Token / valor | Regra |
|---|---|---|
| Conteúdo | `surface.sheet-white` #ffffff | Leitura e formulários |
| Agrupamento | `surface.document-grey` #e4e4e4 | Canvas ou faixa contextual |
| Petróleo | `surface.deep-petrol` #132728 | Texto principal claro e fundo escuro |
| Cenário decorativo | `backdrop.abyss` #080f10 | Apenas arte escura |
| Ciano escuro | `signal.500` #0EA7C7 | Texto sobre petróleo: 5,47:1; nunca sobre branco/cinza |
| Ciano branco | `signal.600` #057A99 | Só sobre branco: 4,94:1; cinza reprova |
| Ciano claro seguro | `signal.700` #046C88 | Branco 5,99:1; cinza 4,71:1 |
| Texto sobre ciano 500 | `ink.on-signal` #132728 | 5,47:1; branco reprova |
| Secundário claro | `ink.on-light-muted` rgba(19,39,40,.7) | Piso em claro: 5,82:1 no branco, 5,18:1 no cinza. Não reduzir alpha nem aplicar opacity no contêiner |
| Texto escuro | `ink.on-dark` #e4e4e4 | Sobre petróleo |
| Secundário escuro | `ink.on-dark-muted` #A0CFE7 | Só em fundo escuro |
| Apoio escuro mínimo | `ink.on-dark-subtle` rgba(228,228,228,.6) | Piso em escuro: 5,32:1 no petróleo, 5,92:1 no abyss. Rótulo pequeno e linha legal de rodapé |
| Erro | `state.danger` #B3261E | Em claro, acompanhado de texto |
| Erro escuro | `state.danger-on-dark` #F2B8B5 | Só em escuro |

Hairlines de 1 px: petróleo/12% em claro, branco/10% em escuro. São divisores decorativos; não bastam sozinhos para identificar um campo, seleção ou foco. Limite de campo que dependa da borda usa `ink.on-light-muted` ou `ink.on-dark-muted` com contraste verificado.

Texto normal ≥4,5:1, texto grande ≥3:1; indicador funcional ≥3:1. Validar o composto real no navegador. `ink.on-light-faint` (20%) é só decoração, nunca etapa futura, botão secundário, label ou dado legível. Não reduzir opacidade de todo um painel.

**Piso de opacidade (texto legível).** O contraste é o do composto, não o da cor de origem. Petróleo sobre claro: mínimo 70% (60% dá 3,88:1 no cinza; 40% dá 2,30:1). Off-white sobre escuro: mínimo 60% (50% dá 4,14:1). Abaixo do piso só entra decoração sem informação. Rótulo de 10–12 px nunca usa a exceção de texto grande. Hierarquia abaixo do piso se resolve com tamanho, peso ou posição, não com mais transparência.

**Hover de botão preenchido.** O rótulo acompanha o preenchimento no mesmo estado. Preenchimento `signal.500` exige rótulo petróleo (branco 2,85:1 e off-white 2,24:1 reprovam). Botão petróleo com rótulo claro usa hover `signal.700` (branco 5,99:1, off-white 4,71:1); `signal.600` só serve a rótulo branco puro (4,94:1) e reprova com off-white (3,89:1).

Foco: anel de 2 px, offset 4 px, `signal.700` em claro e `signal.500` em escuro. O anel segue a superfície onde o elemento está, não a cor do elemento: uma regra global de foco em `signal.500` reprova em toda tela clara (2,85:1 / 2,24:1), inclusive no skip link sobre claro. Campo em claro não troca o anel por borda ciano 500. Não recortar o anel com overflow. Erro e seleção incluem texto/semântica; cor sozinha não informa.

## 4. Lei de hierarquia tipográfica

Famílias mantidas: Chillax, Satoshi, Geist e Geist Mono. Os tokens editoriais da v1.1 continuam para landing; produto usa os papéis abaixo.

| Papel de produto | Token | Tamanho / peso / entrelinha | Uso |
|---|---|---|---|
| Título da página | `typography.page-title` | 28–36 px / 600 / 1,15 | Um h1, sem competir com cada seção |
| Título de seção | `typography.section-title` | 20 px / 600 / 1,3 | h2 de grupo funcional |
| Valor decisivo | `typography.value-primary` | 24–32 px / 500 / 1,2 | Um valor principal por região de decisão |
| Texto de trabalho | `typography.body-ui` | 16 px / 400 / 1,5 | Instrução, campos, corpo de produto |
| Label funcional | `typography.label-ui` | 14 px / 500 / 1,4 | Navegação, botão e label; caixa de frase |
| Apoio | `typography.body-small` | 14 px / 400 / 1,6 | Legendas, condições, ajuda local |
| Dado tabular | `typography.data` | 14 px / 500 / 1,4 | Mono, algarismos tabulares |

Título e conteúdo primário usam tinta principal; apoio usa tinta secundária. A hierarquia combina tamanho, peso e espaço, não só opacidade. Uma ressalva que muda a decisão fica com texto normal, antes da ação; não vai para nota miúda.

Eyebrow editorial é opcional, no máximo um por seção importante. Nunca exigir eyebrow em cada painel, nem ciano em todo título. Labels e botões de produto usam caixa de frase e tracking 0; o uppercase espaçado fica no registro editorial. Não alterar as palavras da copy para aplicar estilo.

Corpo editorial: Satoshi 300 em 18 px, linha 1,6, máximo 70ch. Peso 300 nunca abaixo de 16 px. Formulários: 16 px, peso 400. Metadados técnicos podem usar 12 px em mono; não usar esse tamanho para condição, CTA, navegação ou estado.

Moedas, percentuais, saldos, prazos, NAV, hashes, endereços, ticker e identificadores em mono. Não animar a contagem de dinheiro. Linhas comparáveis usam a mesma escala; o valor principal pode sobressair fora da tabela. Hash completo quebra dentro da coluna sem alargar o viewport.

## 5. Marca e forma

Wordmark `Plina.` em Chillax 600; ponto ciano adequado ao fundo, estático. Área livre mínima: altura do P. Sem sombra, distorção ou caixa ao redor da marca.

| Token | Valor | Aplicação |
|---|---|---|
| `radius.none` | 0 | Linhas/células de tabela e divisores |
| `radius.card` | 12 px | Cartão independente, bloco de revisão, textarea |
| `radius.panel` | 16 px | Painel principal, diálogo, drawer e imagem |
| `radius.full` | 9999 px | Botão, chip, campo de uma linha e avatar |
| `radius.deck` | 24 px | Apresentações, não produto |

Não colocar cada linha dentro de um cartão. Uma tabela pode ter moldura externa de 16 px e células internas retas. Preservar rolagem e foco; raio não exige `overflow:hidden` no ancestral de menus. Não aninhar cartões com molduras/sombras: usar espaço e divisores internos.

## 6. Elevação e profundidade

| Nível | Token | Sombra CSS | Quando usar |
|---|---|---|---|
| Repouso | `elevation.none` | none | Tabelas, listas, formulários, cartões comuns |
| Destaque | `elevation.raised` | 0 4px 16px -4px rgba(19,39,40,.12) | Um bloco de decisão/detalhe selecionado por região |
| Sobreposição | `elevation.overlay` | 0 16px 40px -8px rgba(19,39,40,.18) | Menu, diálogo ou drawer acima do conteúdo |

`elevation.cta` é alias depreciado de `raised`. A sombra ciano antiga sai. Em fundo escuro, manter hairline legível: sombra não substitui borda ou foco. Seleção exige indicador textual/semântico, não apenas elevação. Sem escala ou salto do cartão no hover. Glassmorphism continua restrito à navbar editorial sobre conteúdo; não usar em formulário.

## 7. Imagem e motivo ambiente

Blobs escuros existentes continuam: elipses difusas, assimétricas e decorativas, fora da área de leitura, usando os tokens `motif`. Nunca atrás de dado, formulário, aviso ou CTA. Não converter arte em promessa de retorno ou validação.

**Decisão para superfície clara:** não levar blobs ao fundo de trabalho nesta versão. Fluidez ali vem de raios, espaço e microinterações; evita contraste dependente do quadro animado. Uma imagem aprovada pode ocupar uma região editorial separada com raio de 16 px.

Arte em movimento só na região editorial: entrada única de até 320 ms; sem loop ambiente nesta entrega. Não animar o ponto da marca. Se futuramente houver vídeo contínuo, ele exige controle de pausa e alternativa estática. Não criar parallax.

## 8. Componentes e ícones

### Componentes

- Botões: pill, altura mínima 44 px, label funcional 14 px; principal petróleo/branco em claro, hover ciano/petróleo. Secundário com texto e borda contrastantes. Um principal por decisão. Sem sombra ciano.
- Campos: label acima, texto 16 px, padding horizontal 16–24 px; altura mínima 44 px. Multilinha usa raio 12 px. Foco por superfície; mensagem junto do campo ou da ação. Borda decorativa não é o único contorno do campo.
- Painéis: raio 16 px, padding 24 px desktop/16 px celular. Cartões: raio 12 px, mesma lógica de padding. Lista densa usa divisores; não uma coleção de cartões iguais.
- Dados: label secundário → valor principal → condição/prova. Valor e condição mantidos juntos no reflow. Sem ícone em cada métrica.
- Navegação: item selecionado tem `aria-current` no elemento interativo e identificação além da cor. Seletor nativo continua válido no celular.
- Footer: ao fim do conteúdo, nunca fixo cobrindo uma ação. Usar links e texto já aprovados; não inventar credenciais regulatórias. Especificação do footer segue com Flora em paralelo.

### Iconografia: Phosphor

Família única escolhida: **Phosphor**, pacote `@phosphor-icons/react`. A documentação oficial confirma pesos e configuração por tamanho/cor; a seleção abaixo é decisão do design system, não recomendação do fornecedor. [Documentação oficial](https://github.com/phosphor-icons/react).

Padrão **regular**, 20 px, `currentColor`; 16 px para indicador junto a texto, 24 px em navegação. Preservar o traço nativo, sem sobrescrever `stroke-width`. `bold` apenas em estado selecionado acompanhado de label/semântica. Não usar `thin` em controles pequenos: o traço perde presença. `duotone` só em ilustração editorial de 32 px ou mais; não necessário para implementar esta versão.

Mapa semântico: seta para navegar/voltar, caret para expandir, lupa para busca, filtro para filtrar, copiar para copiar hash, seta externa para explorer, documento para documento, aviso para erro. Não usar escudo/check como selo de validação jurídica. A instalação da dependência segue a revisão de deps normal; este pacote não altera `package.json`.

Ícone junto de label é decorativo (`aria-hidden`, não focável). Botão só de ícone precisa de nome acessível explícito, alvo 44×44 e indicação visual compreensível; tooltip não substitui nome. Ícone funcional ≥3:1 contra o fundo. Não misturar bibliotecas novas; migrar ícones existentes na tela alterada sem refazer logotipos de parceiros.

## 9. Espaço e movimento

### Densidade por tarefa

Escala: 8, 16, 24, 32, 64, 128 e 160 px. Em produto: 8 entre label/valor, 16 entre campos, 24 entre grupos, 32 entre seções. Não aplicar o `py-32` editorial a cada painel operacional.

Admin/listas: container máximo 1440 px (`size.workspace-max`), gutter `clamp(16px,3vw,48px)`; aproveitar largura com lista+detalhe 7/12–5/12 a partir de 1024 px quando ambos couberem. Abaixo disso, uma coluna. Contexto com quatro dados usa 2×2 se a largura útil ficar abaixo de 640 px; uma coluna abaixo de 360 px. Não forçar quatro colunas estreitas para cumprir um wireframe anterior.

Formulário: máximo 640 px; texto corrido máximo 70ch. Em desktop, espaço lateral serve para contexto relacionado, sem esticar campos indefinidamente. Editorial mantém container 1280 px, gutter próprio e ritmo amplo. Em celular, 16 px nas bordas; padding 16 px, alvos ≥44 px, lista com altura mínima de 56 px e crescimento livre por conteúdo. Não truncar condição ou valor.

### Movimento

Easing único: `cubic-bezier(0.16,1,0.3,1)`. Animar apenas propriedades necessárias, nunca `transition: all`.

| Token | Duração | Uso |
|---|---|---|
| `instant` | 120 ms | Press: deslocamento opcional de 1 px no botão, sem mover o layout |
| `fast` | 160 ms | Hover, cor de link/botão, caret ao abrir |
| `base` | 220 ms | Entrada de painel/dialog; fade e até 8 px de deslocamento |
| `slow` | 280 ms | Barra vertical decorativa da lista editorial |
| `reveal` | 320 ms | Entrada editorial única, opacity + translateY até 8 px |

Produto: troca de etapa mostra conteúdo/foco imediatamente; não esperar animação para habilitar controles. Movimento opcional no contêiner não pode deslocar o foco para fora da viewport. Disclosures funcionam por teclado com e sem animação; não animar `height:auto` por truques que recortem conteúdo. Não remontar formulário para animar, perder rascunho ou reenviar ação. Refetch não dispara entrada ou reposiciona foco.

Reveal no scroll só em seções editoriais não críticas, uma vez, sem cascata. Conteúdo nasce visível sem JS; nenhum saldo, erro, condição ou botão fica esperando scroll para aparecer. Loading usa texto estático acessível; shimmer/pulso não são necessários.

`prefers-reduced-motion: reduce`: duração 0, transform none, scroll automático sem animação; conteúdo totalmente visível. O estado funcional continua mudando. Hover tem equivalente por foco e não revela informação indispensável exclusivamente no mouse.

## 10. Voz e estados

Copy de domínio permanece com Consuelo/Norma; a v1.2 não aprova texto novo. Sem promessa de retorno, titularidade antecipada, selo jurídico ou equivalência monetária inventada. Regra regulatória não vai para o footer para liberar espaço.

Todo componente composto prevê: vazio sem inventar dados; carregando com status; erro junto da região/ação; bloqueado com motivo aprovado e sem ação habilitada; sucesso somente com confirmação do estado real. Erro de lista não vira filtro vazio. Fechar uma mensagem não pode deixar uma região sem estado compreensível. Provas existentes continuam acessíveis por link; animação e ícone não substituem evidência.

## 11. Reconciliação e migração

- Raio binário da v1.1 foi substituído pelo mapa 0/12/16/pill; deck 24 continua só em apresentações.
- Sombra única foi substituída por níveis 0/1/2; alias `cta` aponta para `raised`.
- Três superfícies continuam, sem alternância compulsória nem grandes faixas escuras em todo painel.
- Corpo editorial 300 permanece; produto tem corpo 400 e labels 500 em caixa de frase.
- Eyebrow deixou de ser obrigatório; números em mono permanecem.
- Durações antigas 300–900 ms foram reduzidas conforme §9; nenhum loop novo.
- As correções de acessibilidade da v1.1 permanecem: `signal.600` falha no cinza; branco falha no ciano 500; foco ciano 500 falha em superfície clara.
- `DESIGN.md` é legado. Seu raio binário e sombra única não devem orientar telas novas; consultar este documento.

Aplicação: admin primeiro, depois investidor/cedente/comprador, por PR de tela. Preservar APIs, copy aprovada, dados, estados, hashes, foco e rascunhos. O PR compara antes/depois na mesma fixture. Esta entrega não aplica CSS no app e não declara produção atualizada.

## 12. Proibições

Neon, gradiente de texto/borda, sombras coloridas, glass em conteúdo, card ícone+título+texto repetido como solução universal, números em fonte proporcional, múltiplos CTAs primários concorrentes, uppercase longo, texto secundário sem contraste, confete, contador de dinheiro animado, blob em formulário, layout que corta dados ou foco, evidência substituída por um check.

## 13. Self-check e aceite

1. Sinal ciano limitado e pares corretos para cada fundo; foco preservado.
2. Texto legível ≥4,5:1 e indicadores funcionais ≥3:1, medidos no composto real.
3. Um h1; h2 por grupo; valor principal distinto dos labels; condição junto da ação.
4. Raio corresponde ao papel; nenhum cartão dentro de cartão com moldura própria.
5. Nível 0 por padrão, 1 com função explícita, 2 só sobreposição.
6. Números em mono/tabular, hash completo e sem overflow da página.
7. Produto usa labels 14 px e corpo 16 px; uppercase editorial não domina o fluxo.
8. Phosphor consistente; ícones decorativos silenciosos; controles com nome e alvo ≥44 px.
9. Movimento nos tempos definidos, conteúdo visível sem JS, modo reduzido sem deslocamentos.
10. Tab, Enter, Espaço, Escape quando aplicável e restauração do foco funcionam; foco não é roubado por refetch.
11. Conferir 390 e 1440 px, 320 px para reflow, zoom 200%, textos longos, vazio/carregando/erro/bloqueado/sucesso.
12. Copy e comportamento financeiro intactos; revisão visual de Íris, gate de Vera e revisão final do Atlas na implementação.

Na entrega da doutrina: validar JSON, aliases e correspondência dos exports; executar `node design-system/check-contrast.mjs`. O script compõe tintas translúcidas sobre a superfície e trava os pisos de opacidade; `--scan app components` lista no código as classes abaixo do piso, o foco em ciano 500 e o hover `signal.600` com rótulo off-white (`--strict` falha a execução). Isso não substitui medição em tela, leitor de tela ou gate do app.
