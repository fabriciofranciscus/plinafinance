# Acompanhamento do Desenvolvimento — Plina (para Fabrício, CEO)

> Visão executiva do estado do produto. Linguagem de negócio, foco em **o que já
> funciona, o que está em andamento, o que falta e o que depende de terceiros**.
> Para o que depende de **decisão sua**, ver [`DECISOES-CEO.md`](./DECISOES-CEO.md).
> Atualizado em **2026-08-19**. Para o detalhe de engenharia, ver
> [`docs/DOCUMENTACAO-TECNICA.md`](./DOCUMENTACAO-TECNICA.md); para o plano completo,
> [`docs/PRD-plina-v1.md`](./PRD-plina-v1.md).

---

## 1. Onde estamos, em uma frase

O produto está **funcionando ponta a ponta em ambiente de teste (testnet)**: dá para
demonstrar um investidor entrando, passando por KYC, pagando via PIX e recebendo o token
PLINA-RF na carteira — tudo auditável on-chain. O que falta para ir a produção (mainnet)
são, em boa parte, **integrações com terceiros** (custódia Fireblocks, assinatura DocuSign,
PIX real, APIs das administradoras) e o **fechamento jurídico/regulatório do fundo**.

---

## 2. O que já funciona hoje (demonstrável)

Tudo abaixo roda em testnet e pode ser mostrado a um investidor ou parceiro:

- **Investir (`/investir`)** — fluxo completo: login → KYC → escolha de classe (Sênior/
  Subordinada) → cotação → pagamento PIX → recebimento do token. Cada passo gera registro
  auditável na blockchain.
- **Minha posição (`/minha-posicao`)** — o investidor vê seu saldo por classe, lido
  diretamente da blockchain (não de um banco de dados interno).
- **Pool (`/pool`)** — painel público com NAV, total de tokens e composição da carteira,
  com link de auditoria pública.
- **Vender (`/vender`)** — cedente faz cadastro/KYC, simula o deságio e envia a cota;
  acompanha o andamento por um link.
- **Comprar (`/comprar`)** — calculadora comparativa, captura de lead e reserva de cota por 72h.
- **Admin (`/admin`)** — painel interno para originar cotas, conduzir o funil de venda,
  liquidar e operar o clawback.
- **Política de clawback (`/politica-clawback`)** — as 4 hipóteses formais publicadas.

> Em resumo: **a espinha dorsal do produto existe e é demonstrável**. O trabalho restante é
> substituir os "simuladores" por integrações reais e fechar a estrutura regulatória.

---

## 3. Painel de status por fase

Legenda: ✅ pronto · 🟡 parcial (núcleo pronto, falta integração real) · 🔲 não iniciado / preparação.

| Fase | O que é | Status | Leitura para o CEO |
| --- | --- | --- | --- |
| **M0 — Fundação** | Segurança e prontidão para mainnet | 🟡 | **Fase 01.** Base de segurança da Fase 1 entregue. Falta definir a **guarda das chaves** (três opções, decisão 2) e o login admin corporativo. |
| **M1 — Vender** | Compra de cota do cedente (PIX 48h + assinatura) | 🟡 | Funil completo no produto; falta **DocuSign real, PIX real e APIs das administradoras**. |
| **M2 — Comprar** | Revenda da cota ao comprador-usuário | 🟡 | Calculadora, lead e reserva prontos; falta **sinal PIX real e transferência via administradora**. |
| **M3 — Investir BR** | Investidor institucional brasileiro | 🟡 | **Fase 02** — não bloqueia mainnet. Fluxo completo e classes Sênior/Subordinada implementadas; o **termo do FIDC** e o questionário de *suitability* entram com a constituição do fundo. |
| **M4 — Investir Intl** | Investidor internacional (USDC/EURC) | 🔲 | **Fase 02.** Apenas o "gate" preparado; trilha internacional inteira a fazer. |
| **M5 — PLINA-RF (ficha técnica)** | NAV, prospecto, transparência do token | 🔴 | `/pool` mostra NAV e composição, mas **o valor por token está sendo calculado errado** — ver abaixo. Falta **histórico de NAV, prospecto PDF e janelas de liquidez**. |
| **M6 — Compliance** | Screening OFAC/PEP, jurídico, LGPD | 🔲 | **Partido**: o **screening de cedente e comprador** é fase 01 — é obrigação de AML da própria Plina ao comprar cota de pessoa física, não do fundo. A página de compliance com prestadores registrados é fase 02. |
| **M7 — Soroban (waterfall)** | Cascata de resgate em contrato on-chain | 🔲 | Hoje a cascata roda no servidor; **contratos ainda não escritos**. |
| **M8 — Operação** | Monitoramento, alertas, relatórios | 🟡 | Observabilidade e rate-limit no ar; falta **alertas e relatório mensal automático**. |
| **M9 — Cutover** | Virada para mainnet | 🔲 | **Fase 01.** Preparado com trava de segurança. Com o faseamento de 19/08, **depende de M0, M1, M2 e da parte de NAV do M5 — não de M3 nem de M6**. |

*Fonte: quadro de status do PRD (snapshot 2026-05-29).*

---

## 4. O que depende de terceiros (não é só código)

Estes itens **não estão sob controle total do time de engenharia** e tendem a definir o
caminho crítico para mainnet:

| Dependência | Para quê | Situação |
| --- | --- | --- |
| **Estrutura formal do FIDC** | Veículo regulado (CVM 175) | A constituir — **é a porta de entrada da fase 02**, não pré-requisito de mainnet. A fase 01 opera sob a Lei 11.795 com capital próprio. |
| **Guarda das chaves** | Assinar qualquer operação em produção | **Três opções em aberto** (decisão 2). A fase 01 assume guarda própria com múltiplas assinaturas, sem fornecedor — trocar depois é rotação de assinatura, não migração. |
| **DocuSign** | Assinatura jurídica de cessões e termo do fundo | Hoje simulado; precisa do contrato/conta real (M1/M3). |
| **PSP de PIX** | Pagamento/recebimento reais (Stark, BTG ou similar) | Hoje simulado; provedor a definir (M1/M2). |
| **APIs das administradoras** | Validar e transferir a cota (Embracon, Caixa, Bradesco, Porto, Itaú…) | A integrar; há caminho alternativo manual como contingência (M1). |
| **Custodiante regulado, auditoria (Big Four) e rating** | Exigências do fundo | A contratar — **fase 02**. Saíram do caminho crítico de mainnet com o faseamento de 19/08. |

> **Mensagem-chave, revista em 19/08.** Com a fase 01 sendo operação privada sem FIDC, o
> gargalo de mainnet deixou de ser a constituição do fundo e passou a ser **contratos
> operacionais** — assinatura eletrônica, PIX e administradoras — mais os defeitos técnicos
> da fila de engenharia. Constituir o fundo, custodiante, auditoria e rating continuam
> essenciais, só que para a **fase 02**.

---

## 5. Progresso recente

Frentes entregues nas últimas iterações:

- **Fundação de segurança (M0, Fase 1):** assinatura à prova de falhas em mainnet, alarmes de
  saldo, observabilidade, *feature flags* e proteção anti-bot nos formulários.
- **Classes Sênior e Subordinada (M3):** seleção na interface, emissão dos dois tokens e
  acompanhamento da posição por classe — base da estrutura de risco do fundo.
- **Conta unificada + KYC (Pessoa):** uma identidade única do cliente compartilhada entre os
  fluxos de vender, comprar e investir.
- **Endurecimento do fluxo de compra:** o valor do investimento agora fica "amarrado" à
  cotação no servidor e a troca de ativos virou uma operação atômica — elimina uma classe de
  erro/fraude.

---

## 6. Próximos passos típicos

Em ordem aproximada de prioridade para destravar mainnet:

1. **Fechar a estrutura do FIDC** e contratar custodiante/auditoria/rating (M6) — caminho crítico.
2. **Conectar Fireblocks** e migrar o login admin (M0 Fase 2).
3. **Integrar DocuSign e PIX reais** no fluxo de vender (M1).
4. **Corrigir o cálculo do valor por token antes do primeiro registro em blockchain**, e só
   depois completar a ficha técnica (histórico de NAV, prospecto) para o investidor (M5).

> **Achado de 18/08 — o valor por token está superestimado.** Quando uma cota é realizada, o
> dinheiro entra na conta do fundo e, por um erro de cálculo, os tokens daquela cota saem da
> divisão. O efeito é o valor por token aparecer maior do que é. Num exemplo com duas cotas, o
> número correto seria R$ 1,06 e o sistema mostra R$ 2,13. Num cenário em que todas as cotas
> foram realizadas, o cálculo devolve **zero** — e é esse número que o sistema usaria para pagar
> quem quisesse sacar. Nada disso causou prejuízo até agora porque o saque ainda é simulado e
> não há investidor externo, mas o número já aparece na página pública `/pool` e é o mesmo que
> seria gravado em blockchain de forma permanente. A correção está especificada e é o item 6 da
> fila de engenharia; ela precisa entrar **antes** do primeiro registro em blockchain.
5. **Executar o checklist de cutover** e o comunicado à CVM (M9).

---

## 7. Como acompanhar o desenvolvimento

- **Ver funcionando:** peça uma demo do fluxo `/investir` em testnet (5 min) — é a melhor
  forma de sentir o estágio do produto.
- **Status detalhado por item:** [`docs/PRD-plina-v1.md`](./PRD-plina-v1.md) (quadro de módulos).
- **Decisões técnicas registradas:** [`docs/M0-foundation-fase1.md`](./M0-foundation-fase1.md)
  e [`docs/2026-05-18-quote-binding-and-atomic-swap.md`](./2026-05-18-quote-binding-and-atomic-swap.md).
- **Operação/incidentes:** `docs/runbooks/`.
- **Histórico de entregas:** os *Pull Requests* no GitHub agrupam cada frente (M0, M1, classes…).

---

## 8. Mini-glossário (termos técnicos em linguagem simples)

Os termos de negócio (FIDC, CVM 175, consórcio, deságio…) você já domina; aqui ficam só os
técnicos que aparecem nas conversas com o time:

- **Testnet / Mainnet** — rede de **testes** (sem dinheiro real) versus rede **de produção**.
  Estamos demonstrando em testnet; a virada para mainnet é a fase M9.
- **On-chain** — registrado na blockchain, público e auditável por qualquer um.
- **Token PLINA-RF** — a representação digital da cota do fundo na rede Stellar.
- **Carteira (wallet)** — onde o investidor "guarda" o token. Na Plina, ela é criada
  automaticamente no login (via **Privy**), sem o usuário lidar com chaves.
- **KYC** — verificação de identidade do cliente, exigência regulatória.
- **Trustline** — a "permissão" que a carteira do investidor precisa ter para receber o
  token; só é liberada após o KYC.
- **Swap atômico** — a troca de um ativo por outro em uma única operação indivisível: ou
  acontece por inteiro, ou não acontece — sem risco de ficar "pela metade".
- **Clawback** — a capacidade regulatória de **recuperar** tokens já distribuídos, acionável
  apenas sob as 4 hipóteses formais publicadas.
- **NAV** — valor patrimonial do fundo por cota (quanto vale cada token). O número que hoje
  publicamos é o **valor dos ativos**: ainda não desconta provisão para inadimplência nem a
  taxa de administração. O NAV *líquido* — que é o que precifica emissão e resgate — depende
  das decisões 4 e 4b em [`DECISOES-CEO.md`](./DECISOES-CEO.md).
- **Anchor (Etherfuse)** — o parceiro regulado que converte **reais ⇄ cripto via PIX**.
- **Fireblocks** — a tecnologia de **custódia institucional** que guardará as chaves do fundo
  em produção (padrão usado por bancos e gestoras).
- **Custódia / self-custody** — quem guarda as chaves: o **fundo** usa Fireblocks; o
  **investidor** guarda as suas próprias (self-custody) via Privy.
- **POC / MVP** — *prova de conceito* (o que temos hoje, em testnet) e *produto mínimo viável*
  (o alvo em mainnet).
- **Feature flag** — uma "chave" que liga ou desliga um recurso sem precisar de nova versão —
  usamos para abrir funcionalidades de forma controlada.

---

*Este documento é um retrato do momento. Conforme as integrações com terceiros forem
fechando, os status 🟡 migram para ✅.*
