# Decisões pendentes — Fabrício (CEO)

> **O que é este documento.** As decisões que só o CEO pode tomar, reunidas num lugar só.
> Cada uma **trava trabalho de engenharia hoje** — não são consultas de cortesia. Para cada
> uma: a pergunta, o que ela destrava, as opções com seus custos, e a recomendação da
> engenharia.
>
> **Data:** 2026-08-18 · **De:** Thais (CTO) · **Para:** Fabrício (CEO)
> Detalhe técnico em [`ARQUITETURA-ALVO.md §14`](./ARQUITETURA-ALVO.md); estado do produto em
> [`ACOMPANHAMENTO-CEO.md`](./ACOMPANHAMENTO-CEO.md).

---

## Resumo em uma tela

| # | Decisão | O que trava | Urgência |
|---|---|---|---|
| 1 | ~~Soft-launch sem o FIDC?~~ **Respondida pelo one-page** — falta confirmar a leitura, e como o seed entra | o escopo de tudo antes da mainnet | **alta** |
| 2 | Custódia das chaves do fundo: qual fornecedor | assinar qualquer operação em produção | **alta** |
| 3 | Yield-alvo da Sênior e mix Sênior/Subordinada | o motor de precificação do vendedor | **alta** |
| 4 | Provisão para inadimplência, **e como as taxas entram no NAV** | o NAV publicado, a ficha técnica e o track record da fase 02 | **alta** |
| 5 | Volume-alvo no cutover (AUM, cotas, investidores) | dimensionamento e orçamento de infraestrutura | média |
| 6 | Quem aprova um clawback — nominalmente | a dupla aprovação, hoje inexistente no código | média |
| 7 | Quem detém as chaves do fundo, e quantas pessoas | a topologia de assinatura em mainnet | média |
| 8 | Responsável por dados pessoais (DPO) e prazos de guarda | a página de LGPD e o direito do titular | média |
| 9 | Quem atende um incidente grave, e em que janela | o plano de alertas ter destinatário | baixa |

**Nenhuma delas precisa de resposta técnica.** Todas precisam de uma frase de decisão do CEO,
ou da indicação de quem responde.

---

## 1. Soft-launch sem o FIDC — respondida pelo one-page, falta confirmar

**O que mudou.** O one-page de 04/08 responde esta pergunta, e responde melhor do que as duas
opções que eu tinha posto aqui. Ele fatia o produto em três fases, e a fase 01 é *"originação
com capital próprio dos sócios/seed, operação privada sob a Lei 11.795/2008, testnet →
mainnet"*. O FIDC sob CVM 175 aparece só na fase 02, junto com administradora, custodiante,
gestor e auditoria.

Ou seja: **vamos a mainnet sem o fundo, e sem investidor terceiro.** Não é "esperar" nem é
"soft-launch com investidor" — é uma terceira resposta, e é a melhor das três, porque o único
caminho sem volta é colocar token de terceiro na mão de alguém sob um enquadramento que
depois se mostre errado. A política de clawback tem quatro hipóteses fechadas, e "erramos o
regime" não é nenhuma delas.

A engenharia já reordenou a fila com base nisso — quatro entregas saíram do caminho crítico
de mainnet e duas subiram. Registro técnico completo, com as alternativas recusadas, em
[`ARQUITETURA-ALVO.md` → Escopo](./ARQUITETURA-ALVO.md#decisão-de-escopo--quem-detém-plina-rf-na-fase-01).

**O que ainda precisa de você — duas frases, não um documento.**

| | A pergunta | Por que trava |
|---|---|---|
| **1a** | A leitura acima está certa? Na fase 01, **ninguém além da Plina detém PLINA-RF**? | se estiver errada, metade da fila volta para o caminho crítico, e é melhor descobrir agora |
| **1b** | O seed entra como **participação na Plina** ou **comprando PLINA-RF**? | se for compra de token, a fase 01 passa a ter holder terceiro e precisa de parecer jurídico sobre o instrumento **antes** da primeira emissão |
| **1c** | Existe LOI institucional que precise alocar **antes** da constituição do fundo? | mesma consequência de 1b, pelo mesmo motivo |

**Recomendação.** Confirmar 1a como está. Para 1b e 1c, se a resposta for "sim" em qualquer
uma, isso não inviabiliza nada — só antecipa a conta do jurídico, e é muito mais barato
antecipar do que corrigir depois da emissão.

*Referência: [PRD §8.1](./PRD-plina-v1.md#8-pendências-para-sponsor-ceo), atualizado em 2026-08-18 com esta resposta.*

---

## 2. Custódia das chaves do fundo

**A pergunta.** Fireblocks, alternativa equivalente, ou guarda própria com múltiplas
assinaturas?

**O que trava.** Sem custódia definida, o sistema **se recusa a assinar em produção** — isso é
proposital e não vai mudar. É o item que separa "pronto" de "operando".

**As três opções.**

| | O que é | Trade-off |
|---|---|---|
| **Fireblocks** | padrão de mercado institucional, com motor de políticas | o estudo interno registra que é **a opção mais cara da categoria para o nosso estágio**; é também a que menos explicação exige a um auditor |
| **Alternativa equivalente** (BitGo e similares) | mesma categoria, outro fornecedor | vale avaliar se o auditor do fundo exigir custodiante qualificado com credencial específica |
| **Guarda própria com múltiplas assinaturas** | recurso nativo da rede, sem fornecedor | **muito mais barata**; transfere o ônus para nós, em compliance e em processo interno |

**O que falta para decidir, e não é técnico:** o piso mensal e o custo por operação de cada
alternativa — ninguém pediu essas cotações ainda. E a pergunta que só o auditor do fundo
responde: **ele exige custodiante qualificado?** Se exigir, a terceira opção sai da mesa e a
decisão fica entre duas.

**A decisão de faseamento (18/08) responde metade disso.** Na fase 01 não há terceiro detendo
token, e o auditor que poderia exigir custodiante qualificado só existe na fase 02. Então a
arquitetura assume **guarda própria com múltiplas assinaturas na fase 01**, e a escolha de
custodiante passa a ser uma decisão de fase 02 — tomada contra a exigência real do auditor, não
contra a suposição sobre ela.

O que torna isso seguro é técnico e vale saber: **trocar de custodiante depois é rotação de
assinatura, não migração.** Acrescenta-se a chave do novo custodiante à conta, remove-se a
antiga, e pronto — sem reemitir token, sem mexer em quem detém o quê, sem parada. Não estamos
nos amarrando a nada.

**Recomendação.** Não assinar contrato de custódia agora. Pedir as cotações e fazer a pergunta
ao auditor a tempo da fase 02, e casar a assinatura do contrato com a captação — contratar antes
de existir volume é pagar piso sem receita. O que **não** pode esperar, e vale mais que o
contrato: o plano de recuperação das chaves, testado de verdade. Guarda própria transfere para
nós o ônus que o fornecedor absorveria, e esse plano deixa de ser boa prática para virar o
controle principal.

*Referência: [`ESTUDO-CUSTODIA.md`](./ESTUDO-CUSTODIA.md), `ARQUITETURA-ALVO.md` §14.3.*

---

## 3. Yield-alvo da Sênior e mix das classes

**A pergunta.** Qual retorno prometemos à cota Sênior — `CDI + quanto` no Brasil e
`SOFR + quanto` no exterior? E qual a proporção-alvo entre Sênior e Subordinada?

**O que trava.** O deságio pago ao cedente é calculado a partir do retorno prometido ao
investidor. Sem esse número, **o motor de precificação do vendedor não pode ser implementado** —
e ele é o coração do M1.

**Onde estamos.** Há números provisórios registrados desde 30/06, com a marcação explícita de
que **nunca foram confirmados**: `CDI + 5%` no Brasil (faixa segura de 4% a 7%) e `SOFR + 7%`
no exterior (faixa de 6% a 9%). Foram calibrados pelo lado conservador de propósito — é mais
fácil baixar o retorno prometido depois, com dados reais, do que subir depois de ter prometido
pouco. O mix Sênior/Subordinada está pendente no PRD desde a redação original.

**Recomendação.** Confirmar os provisórios como oficiais para o MVP, ou substituí-los. Os
números atuais são defensáveis e comparáveis a FIDC de originador sem histórico; o que não é
defensável é implementar precificação sobre um valor que ninguém aprovou. Se o retorno depender
do resultado do outreach institucional, então a decisão útil hoje é: *"implementa com CDI+5% e
revisamos após as primeiras conversas"* — isso desbloqueia o time sem fechar a porta.

*Referência: [`2026-06-30-spread-cdi-provisorio.md`](./2026-06-30-spread-cdi-provisorio.md), PRD §3.4.*

---

## 4. Provisão para inadimplência

**A pergunta.** O valor do fundo (NAV) que publicamos deve descontar uma provisão para cotas
que não se realizam, ou publicamos o valor bruto?

**O que trava.** O NAV é publicado diariamente, aparece na ficha técnica e é **registrado na
blockchain de forma permanente** — publicado, não volta atrás. Hoje o cálculo soma as cotas
ativas e o caixa, sem qualquer desconto por atraso ou perda.

**Por que é decisão sua e não da engenharia.** Provisionar é política do fundo. A engenharia
sabe implementar qualquer regra; não pode escolher qual.

**Recomendação.** Se a resposta for "ainda não temos base para provisionar" — que é uma resposta
legítima, sem histórico de operação —, então a decisão é **publicar sem provisão e dizer que é sem
provisão**, com essas palavras, na ficha técnica. O risco não é publicar sem provisão; é publicar
sem provisão e um investidor ou auditor descobrir depois que aquilo não era o que parecia.

---

### 4b. E as taxas — a parte que não pode esperar

**O que descobrimos em 18/08.** O NAV que publicamos hoje também não desconta a **taxa de
administração de 2% a.a.** nem a **taxa de performance de 20%**, que estão no one-page como as
duas fontes de margem recorrente. O documento do produto tem a taxa na tabela de receita e não
tem na fórmula do NAV — e o código seguiu a fórmula.

**Por que isso é mais urgente que a provisão.** Na fase 01 a Plina cobra de si mesma, então o
número não prejudica ninguém hoje. Mas a série de NAV da fase 01 é exatamente o **track record**
que vamos mostrar ao investidor e à agência de rating na fase 02. Se ela for publicada sem a
taxa e a fase 02 for com a taxa, o histórico ganha um degrau bem no ponto que o analista olha —
e o lado que parece melhor é o lado em que não havia investidor. Lido de fora, é retorno inflado
em cerca de 2% ao ano.

**E não dá para consertar depois.** Cada NAV diário é registrado na blockchain de forma
permanente. Corrigir um ano de série não é reprocessar um banco de dados: são 250 e poucos
registros de correção, todos permanentes, e a explicação ao auditor de que a série publicada
inteira estava errada.

**A recomendação da engenharia** é aplicar a taxa de administração desde o primeiro dia, sem
mover dinheiro — ela vira uma obrigação acumulada com o gestor e reduz o NAV, que é o efeito
correto. A taxa de performance fica de fora até a decisão 3 (yield-alvo da Sênior) sair, porque
sem benchmark definido não existe excedente a calcular; até lá o NAV declara isso explicitamente.

**O que precisa de você e do jurídico** são três convenções que entram no regulamento do veículo,
e que não podem mudar depois do primeiro dia publicado:

| | Recomendação da engenharia | Por quê |
|---|---|---|
| Contagem de dias | **252 dias úteis** | o benchmark é o CDI, que é 252. Misturar 365 na taxa com 252 no benchmark erra o cálculo do excedente todo dia, num valor pequeno demais para alguém notar olhando |
| Sobre o que incide | **valor do fundo do dia anterior, já líquido** | evita cobrar taxa sobre a própria taxa do dia |
| Quando a performance é cobrada | **na janela de liquidez, com marca d'água** | a marca d'água impede cobrar performance duas vezes sobre a mesma alta |

*Referência: `ARQUITETURA-ALVO.md` §8.2 e §14.11.*

---

## 5. Volume-alvo no cutover

**A pergunta.** Na virada para produção, qual a expectativa de patrimônio sob gestão, número de
cotas na carteira, investidores ativos e operações por dia?

**O que trava.** Sem ordem de grandeza, o dimensionamento da infraestrutura e a frequência das
rotinas diárias são chute. Um fundo com 50 cotas e um com 5.000 pedem desenhos diferentes de
fechamento e de conciliação, e faixas de custo diferentes.

**O que basta.** Não precisa de precisão — precisa de ordem de grandeza e da faixa de erro.
*"Entre 20 e 100 cotas, 10 a 30 investidores, algumas operações por dia"* já é resposta
suficiente para dimensionar. O que não serve é a ausência do número, porque aí a engenharia
super-dimensiona por precaução, e isso é custo mensal recorrente.

*Referência: `ARQUITETURA-ALVO.md` §11.5.*

---

## 6. Quem aprova um clawback

**A pergunta.** Quem, nominalmente, tem poder de aprovar a recuperação de tokens já
distribuídos — e a política exige que um dos dois aprovadores seja do jurídico?

**O que trava.** A documentação e o manual de operação afirmam que o clawback exige duas
aprovações. **O código não tem nada disso** — hoje é um formulário de um clique. Vamos
implementar a dupla aprovação; falta saber quem são as duas pessoas.

**O desenho.** Quem solicita não pode aprovar. São necessárias duas pessoas distintas, e o
pedido expira em 72 horas sem a segunda aprovação. Os dois nomes ficam registrados no evento
gravado na blockchain — é o tipo de controle que um auditor procura primeiro.

**A restrição prática.** Com o time atual, compliance, jurídico e CTO tendem a ser a mesma
pessoa. Duas aprovações exigem **duas pessoas de verdade**. Se hoje não existem duas, a decisão
é quem será a segunda — pode ser você.

*Referência: `ARQUITETURA-ALVO.md` §5.4 e §14.4.*

---

## 7. Quem detém as chaves do fundo

**A pergunta.** Quantas pessoas detêm poder de assinatura sobre a conta emissora do fundo, e
quem são?

**O que trava.** É a única situação em todo o sistema **sem caminho de volta**. Perder a chave
emissora não apaga os tokens dos investidores — eles continuam nas carteiras deles. O que se
perde é a capacidade do fundo de emitir, autorizar novos investidores e executar clawback,
inclusive nas hipóteses em que ele é obrigação regulatória. Isso não é um incidente: é um evento
de encerramento.

**O que já está decidido pela engenharia:** assinatura única em produção está fora de questão.
Serão múltiplos signatários, em custódias distintas, com cópia de recuperação guardada offline e
**testada** antes da virada.

**O que depende de você:** quantas pessoas, e quais. É decisão de governança — quem, na empresa,
tem poder sobre o patrimônio do fundo. Depende parcialmente da decisão 2.

*Referência: `ARQUITETURA-ALVO.md` §10.5.*

---

## 8. Responsável por dados pessoais e prazos de guarda

**A pergunta.** Quem responde como encarregado de dados (DPO), e por quanto tempo guardamos
cada tipo de informação do cliente?

**O que trava.** A página de LGPD e o atendimento a um pedido de titular. Há um conflito real
aqui, e é melhor resolvê-lo antes do primeiro pedido: a regulação do fundo obriga a **guardar**
registros por anos; a LGPD dá ao cliente o direito de pedir **eliminação**.

**Como a engenharia propõe resolver** — a confirmar com o jurídico: enquanto o prazo regulatório
correr, ele prevalece; o que se faz não é apagar, e sim **anonimizar** — os dados pessoais saem,
o registro contábil e a trilha de auditoria permanecem íntegros. O sistema foi desenhado desde o
início para que isso seja possível: os dados pessoais nunca foram para a blockchain, só para o
banco no Brasil.

**O que falta:** o nome do encarregado, e os prazos por categoria. Hoje a política de fato é
"guardar tudo para sempre" — o que também é uma política, só que não escolhida.

*Referência: `ARQUITETURA-ALVO.md` §9.8.*

---

## 9. Quem atende um incidente grave

**A pergunta.** Quando um alerta crítico disparar às 3h de um sábado, quem atende — e é
razoável prometer isso?

**O que trava.** Nada tecnicamente: os alertas serão construídos de qualquer forma. Mas alerta
sem destinatário é ruído com nome bonito, e vale ser honesto sobre a cobertura real antes de
prometê-la a um investidor institucional.

**Achado de 18/08, e ele muda a urgência.** O canal por onde o alerta sairia hoje é o mesmo do
e-mail comum do sistema, e ele foi desenhado para **falhar em silêncio** quando não está
configurado — é a decisão certa para um aviso de rotina e a errada para um alerta grave. Na
prática: um problema sério em produção pode não avisar ninguém, e não haveria como saber que
não avisou. A engenharia vai separar os dois canais e fazer o de alerta falhar de forma
barulhenta, independentemente desta decisão. Mas separar o canal só resolve metade — a outra
metade é ter para quem tocar.

**Recomendação.** Declarar a janela verdadeira — *"horário comercial, com melhor esforço fora
dele"* é uma resposta legítima para o estágio da empresa e melhor que uma promessa que não se
cumpre. Se algum investidor exigir cobertura integral, isso vira custo de operação a orçar, e
aí é decisão comercial.

---

## Informações a obter — não são decisões, são perguntas a terceiros

Estas não dependem de escolha sua, mas de alguém responder. Sem elas, várias decisões acima
ficam sem base:

| O que perguntar | A quem | Destrava |
|---|---|---|
| Data e preço do serviço em reais, por escrito, e se há compromisso de disponibilidade ou é melhor esforço | Etherfuse | a data da **fase 02** — a fase 01 não depende desse trilho |
| A indicação ao Build Award da SCF traz expectativa de contrapartida? (atividade em mainnet, repositório público, suporte a SEP, prazo) | Etherfuse | se traz, parte disso é requisito de arquitetura e entra no sequenciamento da fase 01 |
| Piso mensal e custo por operação da custódia | Fireblocks e alternativa | decisão 2 |
| Exige custodiante qualificado? | auditor do fundo | decisão 2 |
| Preço por assinatura eletrônica, por PIX e por consulta de screening | DocuSign, PSP, fornecedor de screening | entram no cálculo do deságio, não em despesa fixa |
| Data-alvo da constituição do FIDC | jurídico/estruturador | decisão 1 |

---

## O que **não** depende de você

Para delimitar: o resto da fila é engenharia e segue independente destas respostas — conserto da
integração de cadastro e KYC, login nominal no painel administrativo, trava de segurança das
operações, recuperação de operações que travam no meio, correção dos achados de segurança,
caminho de saída do investidor, webhooks e rotinas diárias. É a maior parte do trabalho, e ela
não está esperando reunião.

O que está esperando são estas dez respostas.

---

*Quando uma decisão for tomada, ela sai deste documento e desce para a seção correspondente do
`ARQUITETURA-ALVO.md`.*
