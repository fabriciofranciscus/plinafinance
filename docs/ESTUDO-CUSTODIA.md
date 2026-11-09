# Estudo de Custódia — Fireblocks, BitGo, Copper e Self-Custody

> Contexto Plina: tokenizadora institucional de direitos creditórios de consórcio
> (FIDC sob CVM 175), token **PLINA-RF** emitido na **Stellar**. As chaves que
> precisam de custódia são as **operacionais Stellar**: `issuer` (emite/queima,
> faz clawback) e `distributor` (distribui pro investidor). O `funder` (paga XLM
> de reserva) fica fora do escopo de custódia por decisão de arquitetura.
>
> Estado atual no código: existe o seam `StellarSigner` em `lib/stellar/signer.ts`
> com `KeypairSigner` (testnet, secret em env) e `FireblocksSigner` **planejado**
> (F-M0-1, Fase 2). Em mainnet o signer é *fail-closed*: recusa assinar com secret
> em env. Este estudo valida essa escolha e detalha a integração.
>
> ⚠️ Datas/preços/limites de API têm cutoff de conhecimento jan/2026 — confirmar
> números comerciais direto com cada fornecedor antes de decidir.

---

## 0. O problema, em uma frase

Na Stellar uma transação é assinada com uma chave **Ed25519**. Hoje a Plina guarda
essa secret seed numa variável de ambiente. Em produção, com um FIDC real por trás,
uma secret em env é o **single point of failure** que um auditor (e o regulador)
não vai aceitar: quem vazar o `.env`, o backup, ou o processo Node, controla a
emissão e o clawback do ativo. Custódia institucional resolve isso fazendo a chave
**nunca existir inteira em lugar nenhum** (MPC) ou existir **só dentro de hardware
inviolável** (HSM/multisig em cold storage), com uma **política de aprovação**
auditável em cima de cada assinatura.

As quatro opções abaixo resolvem isso de jeitos diferentes, com trade-offs
distintos de segurança, regulação, custo e esforço de integração.

---

## 1. Fireblocks

### O que é / como funciona
Plataforma de custódia e movimentação de ativos digitais baseada em **MPC-CMP**
(Multi-Party Computation com o protocolo CMP). A chave privada **nunca é
materializada**: ela é matematicamente dividida em *keyshares* distribuídos entre
co-signers da Fireblocks (em enclaves de hardware SGX) e do cliente. Para assinar,
os shares colaboram sem nunca reconstruir a chave. Por cima disso roda a **TAP
(Transaction Authorization Policy)** — um motor de regras que decide quem precisa
aprovar o quê (ex.: "emissão acima de X exige 2 aprovadores + allowlist").

- **Modelo de custódia:** self-custody assistida por MPC (você não terceiriza a
  posse — terceiriza a *infra* de assinatura). Existe também opção de custódia
  qualificada via Fireblocks Trust, se necessário.
- **Stellar:** suporte nativo a XLM e a **assets Stellar customizados**. Assina via
  **RAW signing** (Ed25519 sobre o hash da transação) ou via template Stellar.
- **Tokenization Engine:** módulo próprio pra emissão/gestão de tokens — relevante
  pra Plina, mas o caminho mais simples é usar só o signing e manter a lógica de
  emissão no código atual (`lib/stellar/issuer.ts`).
- **Segurança/compliance:** SOC 2 Type II, seguro, policy engine, allowlists,
  governança multi-aprovador, trilha de auditoria por transação.

### Como integrar com a Plina
É o caminho de **menor atrito**, porque o código já foi desenhado pra isso. O seam
`StellarSigner` (`lib/stellar/signer.ts`) e o README em
`lib/integrations/fireblocks/README.md` já preveem:

```ts
export interface StellarSigner {
  publicKey(): string;
  signEnvelope(envelopeXdr: string, networkPassphrase: string): Promise<string>;
}
export function fireblocksIssuer(): StellarSigner;
export function fireblocksDistributor(): StellarSigner;
```

Implementação concreta (`@fireblocks/ts-sdk`):

1. Criar 2 **vault accounts** na Fireblocks (issuer, distributor), asset `XLM`.
   A Fireblocks deriva o endereço Stellar `G...` correspondente — esse vira o
   `publicKey()`.
2. Em `signEnvelope`: reconstruir a `Transaction` do XDR, calcular `tx.hash()`
   (32 bytes), e disparar uma **RAW signing request** pra aquele vault account
   sobre esse hash.
3. **Poll** do status da transação até `COMPLETED`; extrair a assinatura Ed25519
   (montar os 64 bytes a partir do retorno) e embrulhar num `DecoratedSignature`
   com o *signer hint* da chave; anexar à tx (`tx.addSignature` / append manual).
4. A TAP fica entre o passo 2 e 3: emissão/clawback podem exigir aprovação humana
   no app da Fireblocks antes de a assinatura voltar. Isso casa com a política de
   clawback da Plina (4 hipóteses do whitepaper §6.5).

Nuance importante: como a assinatura agora é **assíncrona** (`Promise`), os
caminhos de emissão precisam aguardar a aprovação da política. O seam atual já
expõe `sign`/`signatureBase64` síncronos pro `KeypairSigner`; a versão Fireblocks
deve usar `signEnvelope` async (já previsto no README). Vale alinhar as duas
assinaturas do contrato `StellarSigner`.

### Por que usar (na Plina)
- Já é a **decisão de arquitetura registrada no PRD** (F-M0-1) — o código está
  *fail-closed* esperando exatamente isso.
- Melhor DX do mercado pra quem assina via API/SDK; suporte a Stellar custom asset
  e RAW signing comprovado.
- Policy engine + multi-aprovação dão o controle de governança que um FIDC precisa
  demonstrar (segregação de funções na emissão e no clawback).

### Contras
- **Custo** é o mais alto da categoria pra um early-stage (mínimos de plataforma +
  fee por AUC/transação). Confirmar comercial.
- KYB de onboarding não-trivial (a própria nota no README diz "bloqueado por conta
  Fireblocks + KYB").
- Você ainda detém keyshares — não é "custodiante qualificado" no sentido
  regulatório estrito (ver BitGo). Para a *posse das chaves operacionais* isso é
  ok; para *custódia do lastro do FIDC* é outro assunto (ver §5).

---

## 2. BitGo

### O que é / como funciona
Custodiante institucional veterano. Dois diferenciais centrais:

- **Custodiante qualificado regulado:** a BitGo Trust Company é uma trust company
  *chartered* (South Dakota; também NY Trust). Isso significa custódia **regulada**
  com segregação de ativos e seguro — o tipo de coisa que satisfaz comitês de
  investimento e auditores de fundo.
- **Modelo de 3 chaves (multisig / TSS):** user key, backup key, BitGo key. Duas
  das três assinam. Suporte tanto a multisig clássico quanto a **TSS** (threshold
  signatures, equivalente conceitual ao MPC). Wallets hot (API, self-managed) e
  cold (custódia qualificada).

- **Stellar:** suporta XLM e tokens Stellar. SDK JS (`bitgo`) + BitGo Express
  (servidor local que expõe REST). WaaS (Wallet-as-a-Service) disponível.
- **Segurança/compliance:** seguro de até US$250M, SOC 2, custódia qualificada.

### Como integrar com a Plina
Trocaria o `FireblocksSigner` por um `BitGoSigner` implementando o **mesmo seam**
`StellarSigner` — a abstração do código já isola isso, então o blast radius é só
`lib/integrations/`:

1. Provisionar wallets Stellar na BitGo (issuer, distributor) — hot wallet via API
   pra fluxo programático, ou custódia qualificada (cold) pra chaves de altíssimo
   valor com aprovação manual.
2. `signEnvelope`: usar o SDK BitGo / BitGo Express pra construir e **half-sign**
   a transação com a user key; a BitGo key co-assina server-side conforme as
   **policies** (spending limits, approvals, allowlist) configuradas.
3. O modelo 3-chaves entrega **recuperação** out-of-the-box (backup key), algo que
   no Fireblocks você resolve via backup de keyshares.

Esforço de integração: comparável ao Fireblocks, ligeiramente diferente no fluxo
(half-sign + co-sign vs. RAW signing + poll). O seam já existente absorve a troca.

### Por que usar (na Plina)
- **Custódia qualificada regulada** é o argumento mais forte pra um FIDC: dá pra
  apontar pro auditor/CVM um custodiante chartered com seguro, não "guardamos
  keyshares". Pode simplificar conversas de compliance.
- Recuperação nativa (backup key) reduz risco operacional de perda de chave.
- Maturidade e seguro elevado.

### Contras
- DX e velocidade de produto historicamente atrás do Fireblocks pra quem quer
  signing programático fino e tokenização.
- Suporte a *features* específicas da Stellar (clawback, auth flags, multisig
  nativo Stellar com pesos) precisa ser confirmado caso a caso — a Plina usa
  `AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED` (ver `issuer.ts`), então
  é mandatório validar que o fluxo de assinatura preserva essas operações.

---

## 3. Copper

### O que é / como funciona
Custodiante e *prime broker* institucional (UK), focado em fundos/hedge funds e
mesa de trading.

- **Custódia:** MPC + cold storage ("Walled Garden"). Chave dividida, nunca
  materializada, semelhante em espírito ao Fireblocks.
- **ClearLoop:** rede de *off-exchange settlement* — você negocia em exchanges
  mantendo os ativos na custódia da Copper. Útil pra tesouraria/trading, **pouco
  relevante** pro caso de emissão de token da Plina.
- **Stellar:** Copper suporta uma ampla lista de ativos; o suporte a XLM existe,
  mas **suporte a assets Stellar customizados (como PLINA-RF) e às operações de
  issuer (clawback/auth flags) precisa ser confirmado** — é o ponto mais incerto
  desta opção e provavelmente o motivo de ela não estar no PRD.

### Como integrar com a Plina
Mesma história de abstração: um `CopperSigner` no seam `StellarSigner`, via API da
Copper. **Mas** o encaixe é pior:
- O produto da Copper é otimizado pra *custódia + trading de tesouraria*, não pra
  *emissão programática de um token customizado*. As operações que a Plina mais
  usa (emitir, distribuir, clawback de um asset próprio) não são o caminho feliz da
  Copper.
- Antes de qualquer integração: validar com a Copper se dá pra (a) custodiar a
  chave de um **issuer de asset customizado** Stellar e (b) assinar `setOptions`,
  `payment` com asset próprio e `clawback`.

### Por que usar (na Plina)
- Faz sentido **se/quando** a Plina tiver uma **tesouraria cripto ativa**
  (gestão de XLM/stablecoins, settlement off-exchange, colateral). Como custodiante
  da chave de emissão do PLINA-RF, é a opção menos aderente das quatro.

### Contras
- Foco em prime/trading, não em tokenização.
- Suporte a custom asset Stellar + operações de issuer incerto.
- Menos material/DX público pra integração de signing do que Fireblocks/BitGo.

---

## 4. Self-Custody

### O que é / como funciona
A Plina guarda as próprias chaves, mas **corretamente** — não secret em env. Três
sabores, do mais simples ao mais robusto:

1. **HSM:** a secret Ed25519 vive dentro de um Hardware Security Module
   (AWS CloudHSM, YubiHSM, Ledger Enterprise/Vault). Assina lá dentro; a chave
   nunca sai do hardware. Operacionalmente próximo do modelo atual, mas sem a chave
   exposta no processo.
2. **Multisig nativo da Stellar:** este é o trunfo que as outras opções não
   exploram. A Stellar tem **multisig nativo com pesos e thresholds** no protocolo.
   Dá pra zerar o `master weight` do issuer e exigir **M-de-N** signers
   (`Operation.setOptions` com `signer` + `*_threshold`), cada signer numa custódia
   diferente (ex.: 1 HSM na AWS, 1 Ledger físico no cofre, 1 chave de um diretor).
   Emissão e clawback passam a exigir quórum — governança real, sem fornecedor.
3. **MPC self-hosted** (Sodot, Turnkey self-hosted, libs open-source): MPC sem
   pagar Fireblocks, mas você assume a operação do cluster de co-signers.

### Como integrar com a Plina
- O código **já suporta multisig**: `lib/stellar/issuer.ts:52` recebe
  `signers: StellarSigner[]` e faz `signers.forEach((s) => s.sign(tx))`. Ou seja,
  dá pra ter N implementações de `StellarSigner` (uma por HSM/Ledger) e combiná-las.
- Caminho prático: implementar um `HsmSigner` (CloudHSM/YubiHSM) que satisfaz o
  seam, configurar multisig nativo Stellar com 2-de-3 signers em hardware distinto,
  e manter o `KeypairSigner` só pra testnet.

### Por que usar (na Plina)
- **Custo marginal baixo** e **zero dependência de fornecedor** (sem lock-in, sem
  KYB de custodiante, sem fee por transação).
- Multisig nativo Stellar é elegante e barato pra atingir segregação de funções.
- Controle total.

### Contras
- **Você vira o custodiante** — todo o ônus de segurança, DR, rotação de chave,
  cerimônia de geração, e **compliance** recai sobre a Plina. Para um FIDC sob
  CVM 175, "nós mesmos guardamos as chaves" é uma posição **muito mais difícil de
  defender** com auditor/regulador do que apontar pra um custodiante qualificado.
- Sem seguro, sem policy engine pronto, sem trilha de auditoria de fornecedor.
- Erro operacional (chave perdida/vazada) não tem rede de proteção.

---

## 5. Comparação

| Critério | Fireblocks | BitGo | Copper | Self-Custody |
|---|---|---|---|---|
| Modelo técnico | MPC-CMP + policy engine | Multisig/TSS 3-chaves | MPC + cold | HSM e/ou multisig nativo Stellar |
| Custodiante qualificado regulado | Opcional (Trust) | **Sim (Trust chartered)** | Sim (UK) | Não (você é o custodiante) |
| Suporte Stellar custom asset + issuer ops | **Comprovado** | Provável (validar) | **Incerto** | **Nativo** (é a própria Stellar) |
| Esforço de integração na Plina | **Baixo** (já desenhado) | Baixo-médio | Médio-alto | Médio |
| Governança/multi-aprovação | **Forte (TAP)** | Forte (policies) | Forte | Você constrói (multisig) |
| Recuperação de chave | Backup de keyshares | **Backup key nativo** | Fornecedor | Você desenha |
| Seguro | Sim | **Até US$250M** | Sim | Não |
| Custo | **Alto** | Alto | Alto | **Baixo** (op-heavy) |
| Lock-in | Alto | Médio-alto | Alto | **Nenhum** |
| Aderência ao caso Plina (emissão de token) | **Alta** | Alta | Baixa | Média-alta |

---

## 6. Recomendação para a Plina

**Curto prazo (mainnet P0): Fireblocks.** Não por ser objetivamente o "melhor",
mas porque (a) é a decisão **já registrada no PRD** e o código está *fail-closed*
esperando exatamente o `FireblocksSigner`, (b) tem suporte Stellar custom-asset +
RAW signing comprovado, e (c) a policy engine entrega de imediato a governança de
emissão/clawback que o FIDC precisa demonstrar. É o menor caminho até produção
seguro. Único bloqueio real: conta + KYB (já mapeado).

**Avaliar BitGo em paralelo** se a conversa com a CVM/auditor do FIDC pedir um
**custodiante qualificado regulado** explícito — o argumento "trust company
chartered com seguro" é mais forte juridicamente do que "guardamos keyshares MPC".
Como o seam `StellarSigner` isola o fornecedor, trocar Fireblocks→BitGo é uma
mudança contida em `lib/integrations/`, não uma reescrita. Vale validar
**agora**, na integração, que o fornecedor escolhido preserva `AUTH_CLAWBACK` e as
auth flags do issuer.

**Self-custody com multisig nativo Stellar** é a alternativa de menor custo e a
mais elegante tecnicamente (o código já aceita `signers[]`), mas **não a recomendo
como custódia primária do issuer** de um FIDC regulado: o ônus de compliance e a
ausência de seguro/rede de proteção pesam demais. Faz sentido como **camada
adicional de governança** (ex.: um dos signers do multisig ser uma chave Ledger
física de um diretor, em cima do custodiante), não como substituto.

**Copper:** descartar pro caso de emissão. Reconsiderar só se/quando a Plina tiver
tesouraria cripto ativa (trading/settlement), que é onde a Copper brilha.

### Próximos passos sugeridos
1. Destravar KYB/conta Fireblocks (bloqueio já conhecido do PRD).
2. Implementar `FireblocksSigner` no seam, com **RAW signing + poll** e DecoratedSignature.
3. **Teste de aceitação crítico:** emitir, distribuir, autorizar trustline e fazer
   **clawback** do PLINA-RF em testnet *via o custodiante escolhido* — confirmando
   que as auth flags do issuer sobrevivem ao fluxo de assinatura.
4. Alinhar o contrato `StellarSigner` para o caminho **async** (`signEnvelope`),
   já que a aprovação por política torna a assinatura não-instantânea.
5. Decisão de compliance: validar com o jurídico/auditor do FIDC se MPC (Fireblocks)
   basta ou se exigem custodiante qualificado (BitGo) — isso decide o fornecedor final.
