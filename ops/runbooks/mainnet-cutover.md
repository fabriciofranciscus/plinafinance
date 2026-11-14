# Checklist de cutover para mainnet — E3-3 (M6)

Estado em 2026-11-14, sobre `2f01001`. Este documento **prepara a decisão**; não autoriza deploy, promoção, DNS, WAF, Edge Config, migration nem transação em mainnet. Quem executa cada passo em produção é a **Thais**. O agente nunca lê `.env.production`, `.aws/` nem secret de mainnet: só confere **existência por nome**.

Complementa `ops/runbooks/instaward2-cutover.md` (gate do candidato, flags, fornecedores, Horizon em fim de vida, reset trimestral da testnet), que continua valendo. Aqui ficam o que bloqueia a mainnet, quem aprova cada item e a evidência que prova. Legenda: **P0** = bloqueia o go/no-go; **P1** = precisa estar resolvido ou aceito por escrito antes de dinheiro real; **Quem** aprova; **Evidência** sem segredo, sem PII.

Fase 01 (D30): só cota **quitada**; preço e NAV valem para saldo devedor zero. Cota com parcelas restantes não entra em mainnet até o modelo com saldo devedor existir (decisão da Thais, 2026-11-13).

## A. Os 9 itens do Argus (parecer da janela 2)

| # | Item | Prio | Quem aprova | Evidência |
|---|---|---|---|---|
| 1 | **Flags da conta issuer** (`AUTH_REQUIRED`, `AUTH_REVOCABLE`, `AUTH_CLAWBACK_ENABLED`) definidas **antes** da primeira trustline (o clawback só vale para trustlines criadas depois); `AUTH_IMMUTABLE` desligado; peso 0 na master key depois do multisig; `home_domain` e `stellar.toml` (SEP-1) publicados | P0 | Argus + Thais | link do explorer da conta com as flags; `/.well-known/stellar.toml` público |
| 2 | **Zero CRITICAL/HIGH abertos do Argus** no commit candidato (conferir o parecer mais recente, não este texto) e `pnpm audit` sem HIGH. Next em versão corrigida do CVE-2026-23870 (em `4f337e8`: `next` 16.2.12; confirmar no advisory) | P0 | Argus | parecer assinado com o SHA; saída resumida do `pnpm audit` |
| 3 | **Isolamento de segredos por ambiente:** chaves de mainnet só no escopo Production da Vercel, nunca em Preview/Development; segredos de produção diferentes dos de testnet; varredura do bundle cliente por segredo em `NEXT_PUBLIC_*` | P0 | Argus + Farol (nomes) | `vercel env ls` por ambiente, só nomes; resultado da varredura |
| 4 | **Conta de posição da Plina e funder:** a posição (OPS-1) na topologia multisig, como issuer e distributor. O funder é a exceção declarada de chave única, com `FUNDER_DAILY_CAP`, saldo mínimo e o aporte de reserva do E2-1 dentro do mesmo teto | P0 | Argus + Atlas | topologia de assinantes (chaves públicas e pesos); valores dos tetos |
| 5 | **Segredo do webhook de produção** da Etherfuse registrado (diferente do sandbox), só no escopo Production, com procedimento de rotação e 503 quando ausente; limiter do webhook distribuído (hoje em memória) | P0 | Argus | teste de rejeição sem segredo; runbook de rotação |
| 6 | **Todos os limiters no Upstash**, não só o público: `sensitiveAuthLimiter`, `adminLoginLimiter`, `leadLimiter` e o do webhook; comportamento em erro do Upstash (fail-open ou fail-closed) decidido; confiança no `x-forwarded-for` | P1 | Argus + Farol | teste por limiter; instâncias próprias de production/preview |
| 7 | **Admin:** credenciais e sessão de produção novas; CSRF e rate-limit de login testados; incorporação manual fechada na fase 01 | P1 | Argus | teste de login/CSRF; ação de incorporação desabilitada |
| 8 | **Clawback e congelamento:** runbook com as 4 hipóteses e dupla aprovação ensaiado em testnet; política de KYC negado (hoje o resgate e o off-ramp seguem abertos) | P1 | Argus + Consuelo + Norma | ensaio registrado com hashes; política escrita |
| 9 | **Contraparte do ativo-ponte:** registrar se o TESOURO de produção tem clawback ou revogação habilitados pelo emissor (risco de congelamento do caixa do fundo) | P1 | Consuelo + Atlas | resposta do emissor por escrito |

### A.1 Estado dos 9 itens em 2026-11-14 (Farol, só leitura; sobre `2f01001`)

Legenda: ✓ atendido · ◐ parcial · ✗ aberto · ? não verificável pelo Farol (dono indicado). Isto é **estado do dia**, não aprovação: quem aprova é a coluna "Quem aprova" da tabela.

| # | Estado | O que foi conferido (testnet, salvo indicação) | Falta |
|---|---|---|---|
| 1 | ◐ | Issuer `GBRG4JKO…` no Horizon: `AUTH_REQUIRED`, `AUTH_REVOCABLE`, `AUTH_CLAWBACK_ENABLED` ligados, `AUTH_IMMUTABLE` desligado, `home_domain = plina.finance`; `stellar.toml` responde 200 e cita o ativo e o issuer | **Multisig ausente:** 1 só assinante (a master key, peso 1) e limiares 0. Peso 0 na master depois do multisig é pré-requisito. Em mainnet o ativo nasce limpo: refazer flags antes da 1ª trustline |
| 2 | ✗ | A `main` ainda usa `next` 16.2.12. `pnpm audit --prod` (13/11): **5 critical e 34 high**. A árvore `integration/e-point` (`b1733c5`, PR #87) sobe o Next para 16.4.1, tem Vera e Argus favoráveis, mas ainda não foi mergeada; nela restam **32 high** de outras dependências | Merge do PR do Next e correção ou aceite formal do Argus para todos os high restantes. O P0 exige zero CRITICAL/HIGH no SHA candidato |
| 3 | ◐ | Só nomes: `NEXT_PUBLIC_*` = só `NEXT_PUBLIC_PRIVY_APP_ID` (público por desenho). Preview e Development ainda usam as mesmas contas testnet de issuer e distributor da Production (C3 de 11/11 pendente) | Na virada: chaves de mainnet só em Production, nunca em Preview/Development; provar a ausência de `PRIVY_VERIFY_STUB`, `E2E_STUB`, `NEXT_PUBLIC_E2E_PRIVY_STUB`, `PLINA_RATE_LIMIT_BYPASS` e `STELLAR_PLINA_POSITION_SECRET` em Production/Preview; Argus varre o bundle cliente; cada ambiente usa store Blob e token próprios |
| 4 | ✗ | Posição `GB4PELA6…` no Horizon: 1 assinante (peso 1), limiares 0; sem multisig. A chave secreta existe como arquivo local único (`~/.plina-custodia/`), tratada como exposta; rotação é bloqueante no M6 | Multisig da posição, issuer e distributor; funder como exceção declarada com `FUNDER_DAILY_CAP`; rotação da chave da posição |
| 5 | ✗ | Varredura nominal de 14/11: `ANCHOR_WEBHOOK_SECRET` existe **só no Preview de uma branch**; **não existe em Production**. O limiter do webhook do anchor usa `createRateLimiter` diretamente e fica em memória, fora de `makeLimiter` | Segredo de produção da Etherfuse (diferente do sandbox) no Production, 503 quando ausente e runbook de rotação; migrar o limiter do webhook para o backend distribuído — só configurar Upstash não o altera |
| 6 | ✗ | `makeLimiter` usa Upstash quando `UPSTASH_REDIS_REST_URL`/`_TOKEN` existem, mas os webhooks do anchor e do DocuSign chamam `createRateLimiter` diretamente e continuam em memória. Varredura nominal de 14/11: nenhuma variável Upstash em Production nem em Preview. Erro do Upstash não é capturado por `consume` e hoje resulta em 500 | Instâncias próprias de production e preview; migrar os dois webhooks; decidir e testar fail-open/fail-closed em erro do Upstash; resolver confiança em `x-forwarded-for` (RT-4); teste por limiter. Mudança em rate-limit passa pelo Argus |
| 7 | ◐ | Sem sessão, `POST /api/admin/originacao` responde 403; as rotas administrativas têm sessão, validação de origem/CSRF e limiter. A incorporação manual ainda aparece na UI, mas falha em `LAUDO_AUSENTE` porque a ação não envia `hashValidacao` | Testar login/CSRF com sessão de produção, mover o limiter hoje em memória para Upstash e remover ou fechar explicitamente a incorporação manual na fase 01 |
| 8 | ? | Não verificado pelo Farol | Argus + Consuelo + Norma (runbook das 4 hipóteses ensaiado; política de KYC negado) |
| 9 | ? | Não verificado pelo Farol | Consuelo + Atlas (resposta do emissor do TESOURO por escrito) |

Resumo: **0 de 5 P0 fechados**. #1 ◐ (flags prontas, falta multisig), #2 ✗ (Next corrigido ainda não mergeado e 32 high restantes), #3 ◐ (isolamento de mainnet ainda não existe), #4 ✗ (multisig e rotação pendentes), #5 ✗ (segredo e limiter de produção ausentes). P1: #6 ✗; #7 ◐; #8–#9 dependem dos donos indicados.

## B. M6 — o que falta e o que é do fornecedor

- [ ] **Etherfuse (fornecedor):** a ordem de produção devolve instrução de depósito vazia para o mercado brasileiro; sem rail BR/PIX de produção o produto não sai. Dono: Etherfuse; contato e prazo por escrito. Aprova: Thais.
- [ ] **SLA, preço, limites e contato de incidente** do fornecedor confirmados por escrito.
- [ ] **PSP regulado em produção:** nenhum Pix real sai com `PSP_PROVIDER` ausente, `SIMULADO` ou Asaas sandbox em `STELLAR_NETWORK=PUBLIC` (falha com `PSP_CONFIG`). O PSP de produção, idempotência e comprovante privado ainda não existem; o sandbox do Asaas exige conta aprovada para Pix e saldo (pendente da Thais).
- [ ] **Cota real:** documento de quitação emitido pela administradora (item 7 do laudo), dentro do frescor; o documento de teste só vale com `STELLAR_NETWORK=TESTNET`. Trava em código (`laudoSha256`, `quitacao.saldoDevedorBrl = "0.00"`, pagamento recusando sem ele) **antes** de qualquer cessão real.
- [ ] **NAV por token:** o código lê o supply circulante do ledger. Em mainnet o ativo nasce limpo; em testnet o supply on-chain pode divergir do banco (resíduo). Decidir e documentar antes da demo (Atlas).
- [ ] **DocuSign de produção:** em 14/11 foram republicados como Secret, em Production e Preview, `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_BASE_URI` e `DOCUSIGN_PRIVATE_KEY`; os endpoints foram conferidos como **sandbox** sem imprimir valores. `DOCUSIGN_CONNECT_HMAC_KEY` continua ausente, portanto o webhook responde 503 e a sincronização é manual; `DOCUSIGN_OAUTH_BASE` está ausente, o que é aceito só no sandbox. Para mainnet, substituir por credenciais de produção, cadastrar HMAC, redeployar e ensaiar assinatura, HMAC, replay, dedupe e PDF privado.
- [ ] **SMTP de incidentes** com test fire sem PII.

## C. Estado das flags: testnet × mainnet

Fonte canônica: `ops/runbooks/instaward2-cutover.md` §2. Regra: **todas** em `false` no primeiro deploy mainnet; `MAINNET_ENABLED` é a última mudança do go/no-go e a primeira do rollback.

| Flag | Testnet (o que o M3/M4 entregam) | Mainnet no primeiro deploy |
|---|---|---|
| `MAINNET_ENABLED` | `false` | `false` |
| `M3_INSTITUTIONAL_GATING`, `INTL_INVESTOR_FLOW`, `CUSTODY_PROVIDERS`, `SOROBAN_WATERFALL` | `false` (ligar só em ensaio aprovado) | `false` |
| `BUYER_SELF_REALIZACAO` | `true` só no smoke aprovado | `false` |
| `LAB_ENABLED` | `true` só em testnet controlada | `false`, nunca ligar |

- [ ] Ausência, erro ou tipo inválido deixa todas desligadas (teste existente, rodar no candidato).
- [ ] Edge Config e env sem divergência; `NEXT_PUBLIC_*` novo exige novo build.

Varredura nominal de 14/11: nenhuma das flags acima existe nas variáveis Vercel. No servidor, `getFlag` consulta primeiro o Edge Config e ele **vence** o env; se o valor remoto estiver indisponível ou não for booleano, cai para o env, que só liga com a string exata `true`. No proxy/edge, `getFlagSync` lê **somente** o env. Antes do cutover, conferir cada nome nos dois lugares: ausente ou `false`, sem divergência; caso contrário, servidor e proxy podem decidir diferente.

## D. Ambientes: `main` × `dev`

| Uso | Vercel/Git | Neon | Regra |
|---|---|---|---|
| Produção | Production, deploy da `main` | branch `main`, host `ep-lucky-breeze…` | Só o deploy de produção pode apontar aqui; execução pela Thais |
| Preview, Development, worktrees e scripts | Preview/Development e branches de trabalho | branch `dev`, host `ep-rough-violet…` | `migrate deploy` de Preview e qualquer ensaio usam apenas o banco dev |

- [ ] Confirmar antes do build que o Preview usa o host **unpooled** de dev e que nenhuma variável de banco ficou presa a uma branch mergeada.
- [ ] Nunca guardar credencial de produção em `.env.local` nem rodar script local contra `ep-lucky-breeze`; o procedimento e as guardas ficam em `ops/runbooks/ambientes.md`.
- [ ] Provar no primeiro Preview do candidato que `_prisma_migrations` avança apenas no dev e não na produção.

## E. Banco, observabilidade e volta

- [ ] Migrations aditivas e idempotentes, ensaiadas em banco descartável e em branch Neon de dev; **`prisma migrate deploy` de produção roda no build da Vercel**, então todo build de Preview contra o banco de produção aplica migration: o Preview precisa de banco próprio antes de mainnet.
- [ ] Ponto de restauração (PITR/branch) do Neon criado e a hora anotada **antes** do deploy.
- [ ] Alertas ativos com test fire: submit on-chain falho, NAV × supply, webhook rejeitado, taxa de erro em `/api/investidor`, Pix de saída incerto.
- [ ] Jobs agendados (`OPS_SCHEDULE_ENABLED`, `OPS_CRON_SECRET`) rodando só no repositório de produção; monitor de snapshot (< 26 h).
- [ ] Rollback: desligar `MAINNET_ENABLED`, promover o deploy anterior (só Thais), reconciliar por hash antes de repetir qualquer operação; nunca retransmitir tx.

## F. Horizon em fim de vida e reset trimestral da testnet

- [ ] Horizon mantido no D30 (indisponível ou divergente = fail-closed, sem fallback para Postgres); ADR pós-D30 com indexador/Hubble; owner e prazo para os anúncios da SDF. Detalhe: `instaward2-cutover.md` §5.
- [ ] Reset trimestral da testnet (congelar evidências, novas contas e asset, reaplicar flags do issuer, rodar o ciclo duas vezes, revogar credenciais antigas). Detalhe: `instaward2-cutover.md` §6.

## G. Go/no-go (somente Thais)

1. Todos os itens **P0** da seção A marcados, com evidência; P1 resolvidos ou aceitos por escrito (Argus + Atlas).
2. Aceites: Vera (gates no mesmo SHA), Consuelo (domínio/NAV), Argus (dinheiro, assinatura, auth, flags, PII), Atlas (final).
3. Thais conduz o go/no-go com Atlas, Argus e os contatos dos fornecedores; liga `MAINNET_ENABLED` na menor exposição prevista.
4. Qualquer incidente: seção E, rollback.
