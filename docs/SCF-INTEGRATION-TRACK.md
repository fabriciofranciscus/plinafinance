# SCF Build — Integration Track · levantamento para a submissão da Plina

> **O que é este documento.** O levantamento completo do Stellar Community Fund, da trilha em que
> a Plina vai submeter, e do parceiro que faz a indicação — com o mapeamento contra o estado real
> do produto e as decisões que ele força.
>
> **Data:** 2026-08-19 · **Owner:** CTO (Thais) · **Sponsor:** CEO (Fabrício)
> Fontes primárias: SCF Handbook, communityfund.stellar.org, docs.etherfuse.com e a API pública
> do fornecedor. Todas listadas na [§10](#10-fontes). Onde este documento estimar, ele diz que
> está estimando.

---

## 1. O que decide, em uma página

**A trilha é a certa.** O Integration Track existe para quem integra building blocks já prontos
do ecossistema Stellar em um produto com usuários — e não para quem constrói protocolo novo. A
Plina integra dois blocos que estão na lista oficial: **Etherfuse** (on/off-ramp e stablebonds) e
**Privy** (wallet). Não é preciso forçar a narrativa.

**O dinheiro tem forma definida.** Até **US$ 150 mil** em XLM, em quatro tranches
(10 / 20 / 30 / 40%), com teto de seis meses. A faixa provável da Plina — duas integrações — é
**US$ 50–100 mil**. A maior parte do orçamento precisa ir para o custo da integração, não para o
produto em volta dela.

**Três achados mudam o plano:**

| | Achado | Consequência |
|---|---|---|
| 1 | O **ativo-ponte `TESOURO` está vivo na mainnet Stellar** — emissor `GCRYUGD5…MYWC`, supply de ~2,48 milhões. O que **não** está disponível é o *trilho fiat* em reais (Pix), não o ativo | a entrada por **USDC → TESOURO** é possível **hoje em produção**, sem depender da data do rail BRL |
| 2 | O tranche final não libera por lançamento em mainnet — libera contra uma **métrica on-chain ratificada pelo painel**, e o handbook nomeia **NAV** como métrica aceita | o defeito do cálculo de NAV (§8.2 da arquitetura) deixa de ser dívida técnica e vira **obrigação contratual com o SDF** |
| 3 | **Tração existente é critério de elegibilidade**, verificável dentro da própria submissão | a fase 01, sem detentor terceiro de token, é o ponto fraco da candidatura — e tem duas saídas, na [§8](#8-onde-a-plina-est%C3%A1-forte-e-onde-est%C3%A1-fraca) |

**O prazo prático não é uma rodada.** Não se submete direto: preenche-se o formulário de
interesse, revisado em fluxo contínuo, e o convite para uma rodada vem por e-mail. O código de
indicação do Etherfuse entra **nesse formulário**. Logo, o relógio começa quando vocês
preencherem — não numa data publicada.

---

## 2. O programa, em números

O SCF é operado pela Stellar Development Foundation com participação da comunidade. Não é um
fundo único: é um conjunto de programas, do estágio de ideia ao pós-lançamento.

| Grandeza | Valor | Base |
|---|---|---|
| Projetos com prêmio registrado | **444** | diretório de projetos ativos com registro de prêmio SCF |
| Total distribuído | **US$ 46,6 milhões** | reconstrução a partir das páginas oficiais de prêmio |
| Prêmio médio por projeto | **US$ 104.952** | total ÷ projetos |
| Rodadas recentes | 27 a 32 projetos, US$ 2,8–3,3 milhões por rodada | rodadas 41 a 44 |

> Os totais em dólar são reconstrução: o SCF não publica o valor de todos os prêmios, e parte é
> denominada em XLM. Servem como ordem de grandeza, não como contabilidade.

**Estado das rodadas em 19/08/2026:** a **SCF #45 está em Panel Review**, com prazo de submissão
vencido em **16/08**. A #46 ainda não tem data publicada. A cadência de 2026 foi irregular — 8/02,
15/03, 26/04, 14/06, 16/08 — variando de cinco a nove semanas, o que aponta para **fim de setembro
ou outubro**. *Isso é estimativa a partir do calendário publicado, não data oficial.*

---

## 3. O Build Award e as três trilhas

O SCF Build é a trilha central para times construindo aplicações e protocolos em Stellar, com
financiamento por marcos até a mainnet. Desde o **SCF 7.0** (janeiro de 2026) ele se divide em
três, cada uma com critérios, faixas e revisão próprios.

| Trilha | Para quem | Revisão |
|---|---|---|
| **Integration** | aplicações **com tração** integrando building blocks existentes | **só painel** de delegados |
| **Open** | times experientes construindo protocolos e primitivas novas | painel **+ voto da comunidade** (NQG) |
| **RFP** | ferramental de desenvolvedor que atende um RFP ativo do ecossistema | painel |

Duas consequências para a Plina:

- **A Integration não passa por voto da comunidade.** Não há campanha, não há mobilização de
  delegados, não há score NQG a perseguir. São dois revisores — três se discordarem — avaliando
  a submissão pelo que está escrita nela.
- **A escolha de trilha não é livre.** O handbook é explícito sobre quem *não* é da Integration:
  times construindo aplicação nova sem tração, protocolos novos, e ferramentas para outros devs.
  Submeter na trilha errada é reprovação no prescreen, não realocação.

---

## 4. Integration Track — o que a trilha exige

### 4.1 A definição, e a distinção que decide

> "The Integration Track supports applications leveraging existing building blocks on Stellar to
> enable everyday financial services… Rather than reinventing the wheel, this track focuses on
> composability."

A distinção que os revisores aplicam: **é um grant *para* uma integração.** O building block
integrado precisa ser o objeto central da proposta — não um parceiro citado numa arquitetura cujo
foco é outra coisa. Uma submissão que descreve a Plina e menciona o Etherfuse é uma submissão de
Open Track mal endereçada.

### 4.2 Elegibilidade

**É para:** times com aplicação e **tração existente** integrando wallets Stellar, anchors e
on/off-ramps, DEXs e protocolos DeFi. Builders que querem combinar peças do ecossistema, não criar
peças novas.

**Não é para:** aplicações novas sem tração (inclusive wallets), protocolos novos não focados em
integração, e ferramentas ou bibliotecas destinadas a outros desenvolvedores.

**Requisitos da submissão:**

- integrar **pelo menos um** building block da Integration List oficial;
- explicar o que se integra, por que melhora o produto, qual a tração existente, e o valor da
  integração com Stellar;
- **a maior parte do orçamento** deve cobrir os custos da integração escolhida;
- propor uma **métrica on-chain com limiar mensurável** para o tranche final.

### 4.3 A Integration List — onde a Plina já está

A lista é curada por Pilots da comunidade e **rotaciona trimestralmente**. Os blocos relevantes:

| Categoria | Bloco | Tempo estimado de integração |
|---|---|---|
| On/Off-Ramping | **Etherfuse** | 1–2 semanas |
| On/Off-Ramping | Koywe *(atende Brasil)* | 1–2 semanas (widget ou API padrão), 3–5 semanas (custom) |
| On/Off-Ramping | alfredpay, Moneygram, Bridge, Abroad, BlindPay, Mercuryo, Anchor Platform | 1 dia a 1+ mês |
| Wallet Integration | **Privy** | menos de 1 dia |
| Wallet Integration | Stellar Wallets Kit, Freighter Connect, DFNS | menos de 1 dia a 5 dias |
| DeFi | DeFindex, Blend v2, Aquarius, Soroswap, Stellar Broker, Templar, Trustless Work | menos de 1 dia a 1+ mês |
| Pagamentos | Stellar Disbursement Platform | 1–2 semanas |

A descrição do Etherfuse na lista é literalmente o que a Plina usa: *"Stablebonds, like
stablecoins, but backed by government issued bonds that pay interest to token holders"* — o
`TESOURO` como ativo-ponte, não apenas a rampa.

**Duas integrações da lista já estão no produto** (Etherfuse e Privy), o que posiciona a
candidatura na faixa intermediária de orçamento por construção, e não por argumento.

> **Nota, sem reabrir decisão:** a **Koywe** também está na lista e atende o Brasil, com tempo de
> integração comparável. É informação para a conversa comercial sobre data e preço do rail BRL —
> existe alternativa que qualifica para a mesma trilha. A decisão de seguir com o Etherfuse é
> estratégica e está registrada em `ARQUITETURA-ALVO.md` §2.3.

### 4.4 Orçamento e tranches

| Escopo | Faixa |
|---|---|
| Uma integração simples | US$ 25.000 – 50.000 |
| Uma integração maior, **ou duas pequenas** | US$ 50.000 – 100.000 |
| Integrações complexas | US$ 100.000 – 150.000 |

| Tranche | Momento | % | Conteúdo esperado |
|---|---|---|---|
| **#0** | aceite do prêmio | 10% | — |
| **#1** | MVP | 20% | contratos em testnet, UI simples, ferramentas de linha de comando |
| **#2** | expansão em testnet | 30% | governança, integrações, adaptadores, profundidade de funcionalidade |
| **#3** | mainnet | 40% | deploy, documentação, SDK, monitoramento, métricas de go-live |

**Despesas elegíveis:** desenvolvimento de núcleo (contratos, backend), frontend e UX, testes e QA,
deploy, SDKs, APIs e documentação para desenvolvedores.

**Despesas não elegíveis:** auditoria, marketing e aquisição de usuários, bounties e distribuição
de tokens, honorários jurídicos e constituição de empresa, e reembolso de trabalho já feito.
*Exceção da Integration Track:* até um terço dos tranches #2 e #3 pode ir para atividades estreitas
de validação com usuários.

**Prazos:** o projeto não pode exceder **seis meses**, e cada formulário de conclusão de tranche
precisa ser submetido em até **90 dias corridos** do recebimento do tranche anterior. Não submeter
faz perder o saldo restante.

### 4.5 A métrica on-chain — o requisito mais consequente

O tranche #3 da Integration Track **não libera por lançamento em mainnet**. Libera contra:

> "a committed, panel-ratified onchain metric (NAV, cumulative volume, or an equivalent measure),
> not on mainnet launch alone."

A proposta declara a métrica, o limiar, a janela de medição e a pegada on-chain registrada. Os
revisores podem **ratificar ou ajustar** o limiar. O prescreen reprova por métrica final "ausente,
vaga, trivial ou irrealista".

Ver a [§9](#9-a-colis%C3%A3o-da-m%C3%A9trica-e-o-caminho) para o que isso significa dado o
faseamento da Plina.

---

## 5. Critérios de submissão e prescreen

Antes do painel, há uma triagem interna. Ela não julga a força da ideia — julga se a submissão
está completa e avaliável. **Nenhum material externo é considerado:** a submissão precisa ser
autossuficiente.

**O que é exigido:**

- **Tração e prontidão de produto** — encaixe demonstrado por tração de usuários significativa
  **ou** por necessidade claramente validada por quem tem experiência relevante no ecossistema. A
  tração precisa ser verificável dentro da submissão.
- **Qualidade** — tecnicamente detalhada, bem estruturada, compreensível sem follow-up.
- **Uso do Stellar** — caso de uso claro, explicação técnica da integração, e **um desenho de
  arquitetura completo**. *"Stellar must be used to meaningfully improve core features, not as a
  superficial integration, or for data storage."*
- **Prontidão para construir** — *"your technical architecture must already be complete at the time
  of application"*, e o **tranche #1 deve ser desenvolvimento de verdade — não planejamento,
  pesquisa ou desenho de sistema**.
- **Orçamento alinhado** — só componentes de desenvolvimento integrados a Stellar, proporcionais
  ao escopo e ao estágio.
- **Contratos inteligentes** — se houver, a submissão precisa incluir plano claro de abrir o código.
- **Tranche #2** — exige **threat model** e **plano de monitoramento**.

**O prescreen reprova por:** entregáveis vagos ou sem valor associado, orçamento inflado ou
desbalanceado, despesas inelegíveis, falta de detalhe técnico ou de arquitetura, entregáveis
desalinhados, e — na Integration Track — métrica final ausente, vaga, trivial ou irrealista.

**Desqualificadores:** entidades que receberam Matching Fund ou Enterprise Fund, times com
Research ou Academic Grants não cumpridos, e times com grants ativos e sobrepostos de Marketing,
Currency Support ou Infrastructure.

**Restrição jurisdicional.** O handbook avisa que algumas jurisdições estão sujeitas a restrições
adicionais que podem afetar o escopo elegível e a estrutura do prêmio — *"for example, deployment
may be limited to testnet"*. Produto financeiro regulado no Brasil é exatamente o perfil que
dispara essa análise, e todo o plano da fase 01 é mainnet. **Precisa ser perguntado antes.**

---

## 6. O processo, na ordem real

1. **Formulário de interesse** em communityfund.stellar.org — descreve o que se constrói, **qual
   trilha** interessa, e **o código de indicação** de quem referiu. Revisado em fluxo contínuo.
2. **Convite por e-mail** para uma rodada aberta, com o prazo, caso os requisitos sejam atendidos.
3. **Submissão** completa e autossuficiente.
4. **Prescreen** interno.
5. **Panel Review** — dois revisores; um terceiro desempata. Podem pedir reunião e ajustar o
   limiar da métrica final. O time recebe pedidos de alteração antes do financiamento.
6. **Prêmio, tranches e verificação** por formulário de conclusão, com prazo de 90 dias entre eles.

### O programa de indicação

Indicação é sinal, não atalho:

- indicadores precisam ser **aprovados e integrados** pela equipe de SCF/Ecosystem Growth —
  membros da comunidade, Ambassadors, Navigators, Pilots, parceiros e contribuidores;
- a atribuição acontece quando o **código do indicador** entra na candidatura inicial;
- o indicador pode receber **até 1% do prêmio efetivamente concedido**, em XLM, de forma
  discricionária e limitada a seis recompensas por ciclo;
- **"Referrals do not guarantee acceptance into SCF, selection, funding, or any other benefit"** —
  as decisões seguem independentes;
- conflitos materiais precisam ser declarados; a declaração não desqualifica automaticamente, mas
  pode influenciar a pontuação.

> **Leitura para a Plina:** a indicação do Etherfuse abre a porta e dá contexto ao time de SCF —
> ela não substitui nenhum critério. E como o indicador tem interesse financeiro potencial na
> concessão, vale confirmar com eles como declaram o conflito.

---

## 7. Etherfuse — o que está vivo e o que não está

**Quem são.** Empresa sediada nos Estados Unidos, listada no diretório do ecossistema como
*Financial Protocols*, com tags de Tokenização, RWA e Stablecoins. Produto: **Stablebonds** —
títulos públicos tokenizados que pagam juros ao detentor. Não consta prêmio SCF no registro do
diretório: eles aparecem como **building block**, não como projeto financiado.

### 7.1 Cobertura, pela documentação deles

| | Cobertura |
|---|---|
| **Mercado fiat vivo** | **México** — MXN sobre SPEI |
| **Mercados futuros** | **Brasil (BRL)**, Coreia (KRW), Argentina (ARS) — todos marcados *Upcoming*, sem data nem preço publicados |
| **Chains de on/off-ramp** | Solana, **Stellar**, Base, Polygon, Monad |
| **Chains de swap** | **Stellar e Solana apenas** |
| **Carteiras embarcadas** | **Stellar apenas** |

Vale reter: das cinco redes que eles suportam, **Stellar é a mais profunda** — é uma das duas com
swap e a única com carteira embarcada. Para uma submissão de Integration Track, isso não é detalhe:
é o argumento de que a integração exercita o que o parceiro tem de melhor na rede.

### 7.2 O achado que muda o desenho

Consultando a API pública de stablebonds do fornecedor em 19/08/2026:

| Bond | Moeda | Presença em Stellar (mainnet) | Supply em Stellar |
|---|---|---|---|
| **TESOURO** | **BRL** | `TESOURO-GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC` | **2.479.998,10** |
| CETES | MXN | `CETES-GCRYUGD5…MYWC` | 69.826.427,50 |
| USTRY | USD | `USTRY-GCRYUGD5…MYWC` | 11.513.981,95 |
| KTB | KRW | `KTB-GCRYUGD5…MYWC` | 102 |
| GILTS | GBP | `GILTS-GCRYUGD5…MYWC` | 1,7 |
| EUROB | EUR | `EUROB-GCRYUGD5…MYWC` | 1,5 |

**O ativo-ponte da Plina existe em produção, com liquidez real.** O que está *Upcoming* é o
**trilho fiat** — a perna Pix que converte reais em TESOURO —, não o ativo.

Nós vínhamos tratando "rail BRL não é GA" como se bloqueasse a ponte inteira. Bloqueia só a metade
fiat.

**A consequência prática:** a regra de swap do fornecedor exige que **pelo menos um lado seja um
stablebond**, e o outro pode ser um stablecoin. Portanto **`USDC → TESOURO` é um swap válido e
disponível hoje em produção na Stellar**. Existe caminho de entrada em mainnet que não passa pelo
Pix deles.

### 7.3 Detalhes de integração que confirmam o plano de migração

- **Identificadores diferem entre sandbox e produção** — a documentação insiste em descobrir via
  `GET /ramp/assets`, nunca hardcode. É exatamente a regra já registrada na §10.1 da arquitetura.
- **Cotações expiram em 2 minutos**, e transações Stellar em 1–2 minutos. Existe endpoint de
  regeneração de transação. Confirma o item "renovar XDR expirado antes de submeter" da §4.5.
- **Swaps só têm webhook** — não há endpoint de polling. Confirma a rota de webhook como
  pré-requisito, e não como melhoria.
- **Partner fee configurável de 0 a 500 bps**, aplicada automaticamente ou por cotação. É a linha
  da §10.3 sobre a integração poder ser receita, não só custo — e agora com o teto conhecido.
- **Taxa de onboarding para carteira Stellar nova**, com erro `Order too small` se a ordem não a
  cobrir. Precisa entrar no cálculo de ticket mínimo operacional.

---

## 8. Onde a Plina está forte e onde está fraca

### Forte

| Critério | Situação |
|---|---|
| Arquitetura completa no momento da candidatura | `ARQUITETURA-ALVO.md` é exatamente esse artefato — e é o item que reprova a maioria das submissões |
| Integra blocos da lista oficial | Etherfuse **e** Privy, ambos já no produto |
| Stellar usado de forma significativa | flags regulatórias nativas, swap atômico, trilha de auditoria ancorada — não é armazenamento de dados |
| Uso profundo do parceiro | stablebond como ativo-ponte, não só rampa |
| Tranche #1 é desenvolvimento real | a migração do anchor é código, não pesquisa |
| Indicação | pelo próprio building block integrado |

### Fraca

| Critério | Situação | Saída |
|---|---|---|
| **Tração existente** | a fase 01 não tem detentor terceiro de token, por decisão registrada | a porta alternativa do handbook: *"a clearly validated need identified by a team with relevant experience"* — o que exige apresentar lista de espera institucional, LOIs, e o POC funcionando ponta a ponta em testnet **dentro da submissão** |
| **Threat model** (tranche #2) | não existe | é trabalho pequeno e a §11.2 e a §6.8 já dão metade |
| **Plano de código aberto** | não há decisão sobre abrir código | não há contratos Soroban na fase 01, então a exigência pode não se aplicar — confirmar |
| **Métrica on-chain** | ver a §9 | — |

### O que o mercado mostra

O vertical de RWA no ecossistema tem **91 projetos ativos, 87 deles vivos, e 41 com prêmio SCF**.
É lane concorrida, não vazia. Comparáveis diretos: **Untangled** (crédito privado tokenizado, Reino
Unido — US$ 320 mil em SCF nas rodadas 31 e 41 mais Liquidity Award), **Spiko** (fundo de mercado
monetário tokenizado, França), **Bondhive**, **EquitX**, **Excellar**, **HiYield**.

Duas leituras que vieram da análise do ecossistema e que os revisores tendem a levantar:

- **três tentativas anteriores neste espaço, julgadas em hackathon, ficaram inativas.** A submissão
  precisa responder por que esta sobrevive.
- **há competidor com repositório verificado vivo em mainnet.** A barra de código funcionando está
  posta; proposta de slide perde para código rodando.

O diferencial defensável da Plina não é "tokenizar recebível" — é o **direito creditório de
consórcio brasileiro**, que nenhum dos comparáveis toca, com enquadramento regulatório desenhado e
originação própria.

---

## 9. A colisão da métrica, e o caminho

A trilha exige métrica on-chain com limiar para liberar 40% do prêmio. A decisão de escopo da fase
01 diz que ninguém além da Plina detém PLINA-RF e que o rail BRL está fora do caminho crítico.

**Se a métrica for volume acumulado pela rampa, a fase 01 como está escopada não produz o número.**

Dois caminhos, e eles não se excluem:

**Caminho A — NAV como métrica.** O handbook nomeia NAV explicitamente entre as métricas aceitas.
A fase 01 produz uma série de NAV ancorada on-chain: é o entregável dela, e foi o argumento que
sustentou a decisão de escopo. Resolve a colisão sem mexer no faseamento.

> **A condição desconfortável:** o NAV precisa estar **correto** antes de virar limiar ratificado
> por painel. Hoje ele superestima — o caixa entra no numerador e os tokens da cota realizada saem
> do denominador — e devolve **zero** com o pool em runoff. O item 6 da fila de engenharia deixou
> de ser higiene contábil e passou a ser pré-requisito de uma obrigação com o SDF. Ver
> `ARQUITETURA-ALVO.md` §8.2.

**Caminho B — antecipar a entrada por USDC.** Com o `TESOURO` vivo em mainnet e o swap
`USDC → TESOURO` disponível hoje, existe uma trilha de entrada que não depende do Pix do
fornecedor. Isso permitiria volume real on-chain como métrica, e inverte uma premissa do roadmap:

> **A inversão.** O PRD sequencia **M3 (investidor BR) antes de M4 (internacional)**, assumindo que
> o trilho doméstico chega primeiro. A capacidade do fornecedor é o contrário: o rail BRL é
> *Upcoming* e o caminho em USDC está vivo. Se a fase 02 for aberta pela ponta internacional, o
> sequenciamento M3 → M4 se inverte — e isso é decisão de produto e regulatória, não só técnica.

Recomendo **A como métrica declarada** e **B como conversa a ter**, nesta ordem: A não depende de
ninguém, B depende de enquadramento regulatório para investidor internacional na fase 02.

---

## 10. Perguntas abertas

| # | Pergunta | Para quem | Trava |
|---|---|---|---|
| 1 | A restrição jurisdicional se aplica a um produto financeiro regulado no Brasil? O deployment pode ficar limitado a testnet? | equipe do SCF | todo o desenho do tranche #3 |
| 2 | A Plina recebeu Matching Fund, Enterprise Fund, ou tem grant ativo de Marketing, Currency Support ou Infrastructure? | interno | elegibilidade — são desqualificadores |
| 3 | Qual o código de indicação, e como o Etherfuse declara o conflito de interesse? | Etherfuse | atribuição da indicação |
| 4 | Data, preço e compromisso de disponibilidade do rail BRL, por escrito | Etherfuse | a data da fase 02 |
| 5 | A indicação traz expectativa de contrapartida — atividade em mainnet, repositório público, prazo? | Etherfuse | se traz, é requisito de arquitetura |
| 6 | O swap `USDC → TESOURO` em produção atende investidor internacional dentro do nosso enquadramento? | jurídico | o caminho B da §9 |
| 7 | Qual métrica e qual limiar declaramos no tranche #3? | CEO + CTO | a proposta inteira |

---

## 11. Próximos passos sugeridos

1. **Preencher o formulário de interesse** com o código de indicação — o relógio começa aí, não numa rodada.
2. **Perguntar a restrição jurisdicional** ao time de SCF antes de escrever a proposta.
3. **Corrigir o cálculo de NAV** (item 6 da fila) — vira limiar contratual, não só número publicado.
4. **Escrever o threat model** do tranche #2.
5. **Montar o dossiê de tração** para dentro da submissão: lista de espera, LOIs, POC em testnet, trilha auditável.
6. **Decidir métrica e limiar** com folga sobre o que a operação realmente produz — o painel ratifica, e o saldo de 40% depende dele.

---

## 12. Fontes

**SCF**
- Build Award — <https://stellar.gitbook.io/scf-handbook/scf-awards/build-award>
- Integration Track — <https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/integration-track>
- Integration List — <https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/integration-track/integration-list>
- Submission Criteria — <https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria>
- Budget & Deliverable Guidelines — <https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines>
- Referral Program — <https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/referral-program>
- Quarterly Governance Process — <https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/quarterly-governance-process>
- Neural Quorum Governance — <https://stellar.gitbook.io/scf-handbook/governance/neural-quorum-governance>
- Rodadas e prazos — <https://communityfund.stellar.org/awards>
- SCF 7.0 — <https://stellar.org/blog/ecosystem/introducing-scf-v7>

**Etherfuse**
- Visão geral, mercados e chains — <https://docs.etherfuse.com/overview>
- Tarifas e trilhos fiat futuros — <https://docs.etherfuse.com/fees>
- Guia da chain Stellar — <https://docs.etherfuse.com/guides/chains/stellar>
- Fluxo de swap — <https://docs.etherfuse.com/guides/testing-swaps>
- Fluxo de onramp — <https://docs.etherfuse.com/guides/testing-swaps>
- Stablebonds ao vivo (API pública) — <https://api.etherfuse.com/lookup/stablebonds>

**Ecossistema**
- Diretório de projetos, prêmios SCF e análise de vertical: LumenLoop / Scout, consultados em 2026-08-19.

---

*Levantamento fechado em 2026-08-19. Números de rodada, lista de integração e cobertura de mercado
do fornecedor mudam — a lista rotaciona trimestralmente e os trilhos fiat abrem sem aviso. Revalidar
antes de submeter.*
