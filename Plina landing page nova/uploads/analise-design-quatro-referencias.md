# Análise de design — quatro referências

*Maple · Ondo · Morpho · Ethena, lidos para a v11 da landing da Plina*

**Acesso:** 27/08/2026. Complementa `analise-design-ondo-finance.md` (19/08/2026), que continua
válido — confirmei que a home da Ondo não mudou de estrutura desde então.

**Sobre o método e seus limites.** Maple, Ethena e Morpho renderizam os números por JavaScript, e o
que se busca do HTML estático não os traz. Os valores abaixo vêm de páginas institucionais e de
material publicado, não de leitura de tela. Onde algo é inferência e não observação, está marcado.
Nenhuma cor foi amostrada diretamente: as descrições de paleta são qualitativas.

---

## 1. O quadro em uma tela

| | **Maple** | **Ondo** | **Morpho** | **Ethena** |
|---|---|---|---|---|
| **Tese do hero** | "Asset Management Onchain" | "Welcome to the Open Economy" | "Connect to the open credit network for the world" | "Digital Dollars for the Internet Economy" |
| **Subtítulo** | "Secure, expert-led financial products for individuals and institutions" | "we design institutional-grade platforms, assets, and infrastructure to bring financial markets onchain" | "Access global liquidity with the best possible terms" | "Earn with USDe" |
| **Fundo** | **claro** | escuro | escuro | escuro |
| **Prova principal** | AUM + pedigree do time | dados ao vivo por produto | logos de clientes (Coinbase, Robinhood) | métricas + transparência |
| **Números** | $4,82 bi AUM · $24,76 bi originados · desde 2019 | TVL $2,19 bi (USDY) · APY 3,55% · $1,03 bi (Stocks) | depósitos e empréstimos no hero | APY médio · rewards · supply |
| **Figurativo** | fotografia P&B da liderança | fotografia de pessoas e cidades | nenhum | ícones e screenshots |
| **Compliance** | KYC e docs legais como feature | badges no card do produto | auditorias e código aberto | disclaimer dentro do fluxo |

---

## 2. O que os quatro fazem igual

Estes são os padrões convergentes. Quando quatro empresas que competem entre si chegam à mesma
solução, o padrão é do problema, não do gosto de quem desenhou.

### 2.1 O número substitui a ilustração

Nenhum dos quatro usa desenho abstrato como elemento gráfico principal. O que ocupa o lugar da
ilustração é o dado: AUM, TVL, APY, supply, volume originado. Em todos, o número aparece em corpo
display, perto do topo, antes de qualquer explicação.

É a escolha mais honesta para produto financeiro e a mais difícil de imitar — **exige ter o número.**
Voltarei a isso, porque é exatamente onde a Plina não pode seguir.

### 2.2 Compliance é argumento de venda, não letra miúda

O padrão mais transponível dos quatro, e o mais contraintuitivo:

- **Ondo** põe `Not Available in US` como etiqueta no próprio card do produto, na vitrine. E mantém o
  acordeão numerado **"Institutional Grade In All We Do"** — 01 High-Quality Assets and Managers ·
  02 Regulated Service Providers · 03 Experienced Leadership · 04 Third-Party Audited Security ·
  05 Compliance-First Focus.
- **Ethena** embute o disclaimer no meio da seção de poupança, não no rodapé: *"sUSDe is not a bank
  deposit… not insured or guaranteed by the FDIC"*, junto da nota de que o APY é média desde
  1º/01/2024. E transforma isso em seção própria — **"Unparalleled Transparency"**, com três pilares:
  visão em tempo real, prova de reservas semanal, atestação de custódia mensal.
- **Maple** trata KYC, documentação legal e due diligence como **características do produto**
  institucional, não como fricção a esconder.
- **Morpho** publica auditorias, bug bounty e verificação formal como bloco de navegação próprio.

A restrição vira credencial. Quem lê é decisor, e decisor lê restrição como sinal de que alguém
pensou no assunto.

### 2.3 Prova social em camadas de confiança crescente

A Ondo é a mais explícita, com três camadas: logos de parceiros (quem trabalha conosco) →
depoimentos com foto e cargo (o que dizem de nós) → **links para imprensa independente** (o que
terceiros publicam sem nossa curadoria). A terceira é a mais confiante: manda o leitor embora da
página para provar um ponto.

Maple faz o mesmo com "Backed by the Best" (Circle, Galaxy Digital, BlackTower, Framework) e Morpho
com "Backed by leaders reshaping finance".

### 2.4 A bifurcação de público é dita, não sugerida

Todos separam explicitamente a quem falam. Maple no próprio subtítulo — *"for individuals and
institutions"*. Morpho segmenta o menu de produtos em **Consumer / Prime / Infra**. Ethena separa
por abas: DeFi, Exchanges, Institutional. Ondo separa por produto, cada um com sua restrição.

Nenhum dos quatro deixa o leitor adivinhar de que lado ele está. **A v10 já faz isso bem**, com as
duas portas na faixa do hero e as outras duas no fechamento.

### 2.5 O hero vende tese, não produto

Nenhum dos quatro heros descreve o que a empresa faz operacionalmente. Todos declaram uma posição
sobre o mundo: a economia é aberta, o crédito é uma rede, o dólar é da internet, a gestão de ativos
é onchain. O produto aparece só depois.

A v10 acerta aqui por caminho próprio: *"O crédito já foi contemplado"* é tese, não catálogo.

---

## 3. Onde divergem, e o que a divergência ensina

### 3.1 Claro contra escuro — e por que Maple é a referência certa

Três dos quatro são escuros. **Maple é claro** — e Maple é, de longe, a referência mais próxima da
Plina: crédito institucional com tomador de um lado e alocador do outro, produto que exige KYC e
documentação legal, público de mesa de risco.

Ondo, Morpho e Ethena são infraestrutura cripto falando com cripto. Maple é crédito falando com
gente de crédito. **A v10 é clara, e essa é a companhia certa.** O `design-system-rebrand/` escuro,
derivado da v3, está mirando o grupo errado.

### 3.2 O que a Maple faz que os outros não: o time é a prova

Maple é a única que põe pessoas com nome, cargo e foto — em preto e branco — e declara o pedigree:
*"decades of experience in financial services, risk management, and technology, with backgrounds
from leading institutions including J.P. Morgan, Bank of America, Deutsche Bank, Amazon,
BlackRock"*.

Para uma empresa sem histórico próprio, **essa é a substituição de tração mais forte que existe.**
O currículo de quem opera é anterior à operação, então não depende dela. A Plina não tem nada disso
na landing hoje.

### 3.3 O que a Morpho faz que os outros não: o código é o ativo visual

Morpho exibe Solidity na home. Não é enfeite geek: é o argumento de que o mecanismo é inspecionável,
posto em forma. É a tradução visual de "open by default, secure by design", que é a headline da
própria seção.

O paralelo para a Plina existe e está sem uso: a operação liquida em Stellar, e o registro é
auditável por qualquer um. Um endereço verificável na página faz o que o Solidity faz para a Morpho.

### 3.4 Onde a Ondo é a mais arriscada e a mais diferenciada

Fotografia de pessoas e de cidades num site de infraestrutura financeira é raro, e é o que separa a
Ondo visualmente de todo concorrente que se apoia em render abstrato. O racional declarado pela
empresa: a tecnologia não é fim, é ferramenta para melhorar coisas do mundo real, para pessoas
reais.

Custo: fotografia autoral, fonte proprietária, grafismo 3D e um sistema de motion com quatro
princípios formam um conjunto caro de alimentar, que só se sustenta com time de marca interno.

**A v10 já tem uma foto documental** (`v5-obra.webp`, o bem em construção). O caminho está aberto e
mal explorado — há mais três imagens não usadas em `uploads/`.

---

## 4. O problema que nenhum dos quatro tem

Os quatro provam com o próprio número:

| | prova de escala |
|---|---|
| Maple | $4,82 bi sob gestão · $24,76 bi originados desde 2019 |
| Ondo | $2,19 bi de TVL só em USDY |
| Morpho | Coinbase, Robinhood e Binance como clientes |
| Ethena | supply e rewards distribuídos |

**A Plina tem zero.** Não é modéstia de copy: é a decisão documentada da v10, e ela tem fundamento
regulatório — sem tabela de retorno-alvo e sem ticket mínimo, cai a leitura de procura de investidor
em oferta com esforços restritos. A página não é material de oferta.

Copiar a estética destes quatro sem ter o que eles têm produz o pior resultado possível: um site que
*parece* ter tração e não tem. O leitor institucional detecta isso em segundos, e o custo é a
credibilidade inteira.

Então a pergunta que a v11 precisa responder não é "como fica parecido com a Maple". É:

> **O que a Plina pode pôr no lugar onde esses quatro põem o número?**

Há quatro respostas legítimas, e elas não competem — mas uma delas tem que dominar a página.

### A · A estrutura como prova

O modelo é o acordeão "Institutional Grade" da Ondo, traduzido para a cadeia fiduciária de um FIDC:
administrador, gestor, custodiante, auditor independente. Numerados, uma linha cada.

**Restrição séria:** o veículo é *estrutura de destino*, não estrutura existente, e os prestadores
ainda não estão contratados. A v8 deixou esses nomes como `[ a preencher ]` de propósito, com a nota
correta de que inventar o nome de um administrador fiduciário seria fabricar um registro sobre uma
empresa real. Enquanto não houver contratação, esta seção só pode descrever **exigências da
CVM 175**, não fornecedores da Plina.

### B · O time como prova

O modelo é a Maple. Currículo é anterior à operação, então não depende de tração. Exige dados que
não estão em nenhum arquivo desta pasta, e fotografia.

### C · O mercado como prova

O que a v10 já faz, e poderia fazer com muito mais força visual. Os números da ABAC são grandes o
bastante para carregar uma página inteira — R$ 232,9 bi comercializados em cinco meses, 753,58 mil
contemplações no período, 12,94 milhões de consorciados. O gesto é o dos quatro sites: número em
corpo display, no topo. A diferença — e ela precisa estar visível — é que **o número é do sistema,
não da Plina**, e carrega a fonte junto.

### D · A verificação como prova

O modelo é Morpho e a seção de transparência da Ethena. Não promete retorno: promete que o que for
dito poderá ser conferido. Para uma empresa pré-operacional é a promessa mais barata de manter e a
mais difícil de fingir.

---

## 5. Para transpor, em ordem de retorno sobre esforço

1. **Etiqueta de restrição de público no próprio card** (Ondo). Investidor qualificado ou
   profissional sinalizado na vitrine, não em disclaimer de rodapé.
2. **Acordeão numerado da cadeia fiduciária** (Ondo), redigido como exigência da CVM 175 enquanto os
   prestadores não existirem.
3. **O time com pedigree** (Maple). Maior ganho de credibilidade por unidade de esforço, se os dados
   existirem.
4. **Disclaimer dentro do fluxo de leitura** (Ethena). Toda afirmação qualificada carrega a
   qualificação no mesmo quadro, não no rodapé.
5. **Endereço verificável em Stellar** (Morpho). O registro on-chain como ativo visual.
6. **Fotografia documental** (Ondo). Três imagens já estão em `uploads/` sem uso.

## 6. Para não transpor

- **O scroll horizontal do hero da Ondo.** Padrão de portfólio de agência aplicado a site
  institucional: desorienta leitor acostumado a rolagem vertical, penaliza teclado e leitor de tela,
  e prejudica indexação.
- **A fonte proprietária.** Só se justifica em escala de marca que a Ondo tem. Uma geométrica
  licenciada bem escolhida entrega quase todo o efeito — e a Plina já tem Chillax e Satoshi.
- **O fundo escuro dos três.** Ver 3.1: a companhia certa da Plina é a Maple.
- **Qualquer número da Plina.** Enquanto não houver operação, o único número legítimo na página é de
  terceiro, com fonte.

---

*Documento produzido em 27/08/2026 a partir da leitura das home pages de maple.finance, ondo.finance,
morpho.org e ethena.fi, da página institucional maple.finance/about, e de material publicado sobre o
reposicionamento da Maple.*
