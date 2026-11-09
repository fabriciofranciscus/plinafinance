# Análise de design — ondo.finance

*Estudo da home institucional e do sistema visual da Ondo Finance*

**Fontes:** https://ondo.finance (acesso em 19/08/2026) e o post oficial "Designing for the Open Economy: Our New Visual Identity", publicado pela Ondo em 03/02/2025 — https://ondo.finance/blog/our-new-visual-identity

---

## 1. Stack técnico e implicação de design

| Camada | Tecnologia | O que isso significa para o design |
|---|---|---|
| Front-end | Next.js (`/_next/image`) | Otimização de imagem nativa; páginas estáticas com dados dinâmicos injetados |
| CMS | Sanity (`cdn.sanity.io`) | Blog, insights, depoimentos e logos do ecossistema são editáveis sem tocar em código |
| Mídia complementar | Cloudinary | Imagens e vídeos editoriais pesados (fotografia, peças de motion) |

**Consequência:** o site é modular, construído por blocos repetíveis alimentados por CMS — não é uma landing page artesanal. Isso permite ao time de marketing publicar notícia, depoimento ou parceiro novo sem ciclo de desenvolvimento, e explica a consistência rígida entre seções.

---

## 2. A tese central do design

Todo o site resolve um único problema de posicionamento:

> **Parecer um banco de investimento e uma empresa de cripto ao mesmo tempo.**

Cada decisão visual serve a esse objetivo. O sinal mais claro é o *logo wall* imediatamente abaixo do hero, que mistura no mesmo carrossel infinito, com a mesma escala e o mesmo tratamento monocromático:

- **TradFi:** BlackRock, Goldman Sachs, Franklin Templeton, Wellington Management, Ripple, Aon
- **Cripto:** Ethereum, Solana, Sui, Aptos, Sei, Jupiter

Não há hierarquia visual entre os dois grupos. **A ausência de hierarquia é a mensagem.**

---

## 3. Arquitetura narrativa da home

A ordem das seções é deliberada e pode ser lida em três blocos:

### Bloco 1 — Credibilidade

1. **Banner de anúncio no topo** — notícia mais recente (lançamento de mint/redemption 24/7)
2. **Navegação enxuta** — Products / Resources / Ecosystem / About + CTA único "Launch App"
3. **Hero** — "Welcome to the Open Economy" (declaração de tese, não de produto)
4. **Logo wall** — prova social institucional imediata
5. **Últimas notícias** — cards editoriais com imagem

### Bloco 2 — Prova

6. **Produtos com dados ao vivo** — Ondo Stocks, USDY, OUSG, cada um com TVL, APY, preço com variação do dia e número de holders
7. **Métricas agregadas com contador animado** — chains suportadas, projetos integrados, TVL total
8. **Depoimentos com foto e cargo** — Larry Fink (BlackRock), Aon, McKinsey, Franklin Templeton, ABN Amro

### Bloco 3 — Convicção

9. **Manifesto "We Believe In"** — Open Finance / Better Systems / Shared Progress, em passos 01–03
10. **"Institutional Grade In All We Do"** — acordeão numerado 01–05 de compliance
11. **Nexus** — camada de tecnologia, com carrossel de tokens (BUIDL, USDC, BENJI, RLUSD, PYUSD, OUSG, ULTRA)
12. **Ecossistema** — "Building the Bridge Between TradFi & DeFi"
13. **Insights / imprensa independente** — links para The Block, CoinDesk, podcasts
14. **Newsletter + footer**

---

## 4. Sistema visual

A identidade atual resulta de um rebrand lançado em fevereiro de 2025, documentado pela própria empresa. Vale registrar os racionais declarados, porque eles explicam decisões que, de outro modo, pareceriam arbitrárias.

### 4.1 Logo — o que não mudou

O logotipo foi mantido. As razões declaradas: reconhecimento de marca já consolidado, necessidade de continuidade num rebrand que mexeu em tudo o mais, e preferência do próprio time.

O nome carrega o conceito: **"Ondo" significa "onda" em esperanto** — referência ao Havaí, onde nasceu o fundador, e alusão à "onda que vem" da tokenização. A forma aberta do símbolo vira a matriz de todo o resto do sistema.

### 4.2 Tipografia — Ondo Sans

Fonte proprietária, desenhada especificamente para a marca.

| Aspecto | Detalhe |
|---|---|
| Base | Família **Gellix**, da foundry Displaay |
| Classificação | Sans-serif geométrica, inspirada no primeiro esboço da Futura, de Paul Renner |
| Estrutura | Oito pesos com itálicos correspondentes; contraformas redondas em `b`, `d`, `p`, `q`; terminais horizontais ou verticais; amplo repertório de caracteres alternativos |
| Customização Ondo | Glifos com **quebras** (*breaks*) no traço, espelhando a abertura do logo — mais evidente no "O" |

**Racional declarado:** combinar a confiança transmitida pela construção sólida de uma sans-serif com uma sensação de abertura e inovação. A quebra no traço é literalmente a tese da empresa desenhada dentro da letra.

**Disciplina de uso:** a Ondo reconhece que abusar dos glifos "abertos" seria excessivo. Eles aparecem em momentos-chave — títulos, números de destaque —, não no texto corrido. O restante usa os glifos fechados, legíveis. É uma decisão madura: o traço distintivo funciona como pontuação, não como textura.

Na aplicação prática: títulos grandes com entrelinha e tracking apertados, *sentence case* predominante, e números tratados como elemento display.

### 4.3 Cor

**Racional declarado:** equilibrar dois pares de tensão —

- moderno e tecnicamente sofisticado ↔ aterrado no impacto sobre o mundo real
- profissionalismo (*institutional-grade finance* for everyone) ↔ acessibilidade (institutional-grade finance *for everyone*)

**Resultado:** uma paleta descrita pela empresa como "mínima porém diversa", composta de tons profundos (*deep*) somados a tons pop.

Na prática observável no site: base neutra escura com tipografia branca, logos de parceiros tratados em monocromia, e a **cor entrando principalmente pela fotografia** — não por blocos chapados. Os tons pop ficam reservados a dados, estados e acentos pontuais. O efeito é que a paleta parece contida mesmo quando há cor saturada em tela.

> *Observação:* os valores hexadecimais exatos não são publicados nas páginas do site; constam do media kit da empresa, hospedado em Notion e não indexável. Para replicar a paleta com precisão seria necessário acessá-lo ou amostrar diretamente das peças.

### 4.4 Fotografia — a decisão mais contra-corrente

O rebrand aumentou deliberadamente o peso da fotografia. O argumento declarado é explícito e vale citar em paráfrase: muitos sites de empresas de blockchain são muito "tech-y" e abstratos; a Ondo enxerga a tecnologia não como um fim em si, mas como ferramenta para melhorar coisas do mundo real, para pessoas reais.

Dois assuntos dominam:

1. **Pessoas** — para materializar o destinatário da tecnologia
2. **Edifícios e paisagens urbanas**, com ênfase em enquadramentos que transmitem **sensação de espaço**

O trocadilho conceitual é assumido: *open economy* = espaço aberto (**open**) + edifícios, portos, pessoas (**economy**).

Essa é a escolha de maior risco e maior diferenciação do sistema. Fotografia de pessoas em site de infraestrutura financeira é raro, e é o que separa visualmente a Ondo de concorrentes que se apoiam em renders abstratos.

### 4.5 Grafismos e iconografia

- **Gráficos 3D** são usados de forma reservada, sobretudo nas páginas e seções que tratam de tecnologia — não como wallpaper geral
- **Ícones em desenho de linha simples**, escolhidos para transmitir espaço e transparência, mantendo parentesco formal com o logo
- **Espaço negativo como elemento ativo**, inclusive dentro dos grafismos e layouts

### 4.6 Animação — quatro princípios de movimento

A Ondo definiu temas de motion antes de animar qualquer coisa. São quatro:

| Princípio | Leitura |
|---|---|
| **Progression** | Avanço, sequência, acúmulo |
| **Compression & expansion** | Contrair e abrir |
| **Opening aperture** | Abertura de diafragma — revelação por ampliação |
| **Unmasking** | Revelação por remoção de máscara |

Aplicações declaradas: introduzir conteúdo novo (parcerias), destacar estatísticas importantes e animar a entrada de imagens.

Repare que **três dos quatro princípios são variações de "abrir"**. Não é motion decorativo: é a mesma tese do glifo quebrado e da fotografia com sensação de espaço, executada no tempo em vez do plano.

Elementos de movimento observáveis na home:

- Scroll horizontal no hero ("Scroll / Swipe to explore")
- Marquee infinito e contínuo do logo wall
- Contadores de dígitos rolantes (efeito *slot machine*) nas métricas agregadas
- Carrossel de tokens na seção Nexus
- Acordeão numerado na seção de compliance
- Transições de hover nos cards editoriais
- Vídeo em loop como peça de conteúdo (não apenas background)

### 4.7 A coerência do sistema

O ponto forte do sistema não é nenhum elemento isolado — é que **a mesma ideia aparece traduzida em quatro linguagens diferentes**:

| Meio | Como "abertura" se manifesta |
|---|---|
| Logo | Forma de onda aberta |
| Tipografia | Quebra no traço do glifo |
| Fotografia | Enquadramentos com sensação de espaço |
| Movimento | Abertura de diafragma, expansão, unmasking |

Um sistema de marca só funciona quando o conceito sobrevive à mudança de meio. Este sobrevive.

---

## 5. O que funciona bem

### 5.1 O hero não vende produto, vende tese

"Welcome to the Open Economy", seguido de "desenhamos plataformas, ativos e infraestrutura de grau institucional para trazer os mercados financeiros para onchain". Nenhum CTA de conversão além de "Launch App".

É posicionamento de empresa de infraestrutura, não de captação de varejo. Quem chega ao site é assumido como decisor, não como investidor impulsivo.

### 5.2 Dados ao vivo como elemento gráfico

TVL, APY, preço com variação diária e número de holders são renderizados como se fossem tipografia decorativa — números grandes, com contadores de dígitos rolantes nas métricas agregadas.

Isso **substitui a ilustração**: a prova visual do site é o número, não o desenho. Para um produto financeiro, é a escolha mais honesta e a mais difícil de imitar por concorrente sem tração.

### 5.3 Compliance embutida no design, não escondida

Este é o ponto mais transponível para estruturas reguladas:

- **"Not Available in US"** aparece como etiqueta ao lado dos produtos restritos, na própria vitrine — não em rodapé jurídico
- **"APY¹"** com nota de rodapé numerada, sinalizando que o número tem qualificação
- **Seção "Institutional Grade In All We Do"**, acordeão numerado:
  - 01 — High-Quality Assets and Managers
  - 02 — Regulated Service Providers
  - 03 — Experienced Leadership
  - 04 — Third-Party Audited Security
  - 05 — Compliance-First Focus

É *design de credibilidade regulatória*: a restrição de público e a cadeia de prestadores viram argumento de venda, não obstáculo a ser escondido.

### 5.4 Prova social em três camadas distintas

| Camada | Formato | Mensagem |
|---|---|---|
| Logos | Carrossel monocromático | Quem trabalha conosco |
| Depoimentos | Foto + nome + cargo + citação | O que dizem sobre nós |
| Imprensa | Links externos (The Block, CoinDesk) | O que terceiros publicam sem nossa curadoria |

A terceira camada é a mais confiante do site: manda o usuário embora da página para provar um ponto.

### 5.5 Vocabulário controlado

- **"Onchain"**, nunca "blockchain" — evita a conotação especulativa do segundo termo
- **"Institutional-grade"** repetido como âncora ao longo de toda a página
- **"Yieldcoin"** — categoria inventada para o USDY, contornando o peso regulatório de "stablecoin"

---

## 6. O que é discutível

### 6.1 Scroll horizontal no hero

O "Scroll / Swipe to explore" é um padrão de portfólio de agência criativa aplicado a um site institucional. Riscos: desorienta leitor institucional acostumado a rolagem vertical, costuma penalizar acessibilidade (navegação por teclado, leitores de tela) e tende a prejudicar indexação.

### 6.2 Custo de manutenção do sistema

Fonte proprietária, fotografia autoral de pessoas e edifícios, grafismos 3D e um sistema de motion com quatro princípios formam um conjunto caro de alimentar. Funciona porque a Ondo tem time de marca interno — a vaga de Senior Brand Designer da empresa pede explicitamente portfólio de sistema de marca, sub-marcas e trabalho de motion. Copiar a superfície sem a estrutura de time produz inconsistência rápida.

### 6.3 Densidade decrescente

A home é longa, e o miolo — o manifesto "We Believe In" — tem densidade informacional muito menor que o topo. Quem chegou para avaliar o produto já decidiu antes dessa seção. O manifesto serve mais à marca do que à conversão.

### 6.4 Taxonomia de marca pouco visível

"Nexus", "Ondo Chain", "Ondo Stocks", "USDY", "OUSG" convivem sem uma hierarquia clara de nomenclatura. Não fica evidente, na navegação, o que é produto, o que é infraestrutura e o que é chain própria.

---

## 7. Aplicação a uma plataforma de crédito tokenizado

### 7.1 Alto retorno, baixo custo

**(i) Etiqueta de restrição de público no próprio card do produto.**
O equivalente brasileiro seria sinalizar investidor qualificado ou profissional na vitrine — não em disclaimer de rodapé. Trata a restrição de público como característica do produto, não como advertência.

**(ii) Acordeão de "institutional grade" traduzido para a cadeia de prestadores.**
Em um FIDC: administrador, gestor, custodiante, auditor independente, agência de rating. Cada um numerado, com uma linha de explicação. Transforma a estrutura fiduciária — que já existe e já é obrigatória — em argumento de design.

**(iii) Números vivos da carteira como elemento tipográfico principal.**
PL, rentabilidade, número de cedentes, prazo médio, índice de inadimplência. Substitui ilustração genérica por prova auditável.

### 7.2 Sobre o sistema visual

**Fotografia em vez de abstração** é a lição mais barata e mais eficaz. Crédito tokenizado tem lastro em atividade econômica real — cedentes, recebíveis, empresas operando. Fotografar isso comunica lastro melhor do que qualquer render de blocos conectados, e diferencia de imediato num setor saturado de estética "tech-y".

**Um conceito único traduzido em vários meios** vale mais do que vários elementos bonitos e desconexos. Antes de escolher cor ou fonte, definir a ideia que precisa sobreviver da tipografia à fotografia ao movimento.

**Não replicar:** o scroll horizontal do hero, e a fonte proprietária — o custo de encomendar e manter uma tipografia customizada só se justifica em escala de marca que a Ondo tem e uma operação em estágio inicial não tem. Uma sans geométrica licenciada bem escolhida entrega 90% do efeito.

---

*Documento produzido a partir de análise da estrutura, do conteúdo e dos padrões de interação da página inicial de ondo.finance, complementada pela documentação oficial de identidade visual publicada pela empresa.*
