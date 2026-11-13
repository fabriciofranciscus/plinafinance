# Checklist de cutover para mainnet — E3-3 (M6)

Estado em 2026-11-13, sobre `4f337e8`. Este documento **prepara a decisão**; não autoriza deploy, promoção, DNS, WAF, Edge Config, migration nem transação em mainnet. Quem executa cada passo em produção é a **Thais**. O agente nunca lê `.env.production`, `.aws/` nem secret de mainnet: só confere **existência por nome**.

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

## B. M6 — o que falta e o que é do fornecedor

- [ ] **Etherfuse (fornecedor):** a ordem de produção devolve instrução de depósito vazia para o mercado brasileiro; sem rail BR/PIX de produção o produto não sai. Dono: Etherfuse; contato e prazo por escrito. Aprova: Thais.
- [ ] **SLA, preço, limites e contato de incidente** do fornecedor confirmados por escrito.
- [ ] **PSP regulado em produção:** nenhum Pix real sai com `PSP_PROVIDER` ausente, `SIMULADO` ou Asaas sandbox em `STELLAR_NETWORK=PUBLIC` (falha com `PSP_CONFIG`). O PSP de produção, idempotência e comprovante privado ainda não existem; o sandbox do Asaas exige conta aprovada para Pix e saldo (pendente da Thais).
- [ ] **Cota real:** documento de quitação emitido pela administradora (item 7 do laudo), dentro do frescor; o documento de teste só vale com `STELLAR_NETWORK=TESTNET`. Trava em código (`laudoSha256`, `quitacao.saldoDevedorBrl = "0.00"`, pagamento recusando sem ele) **antes** de qualquer cessão real.
- [ ] **NAV por token:** o código lê o supply circulante do ledger. Em mainnet o ativo nasce limpo; em testnet o supply on-chain pode divergir do banco (resíduo). Decidir e documentar antes da demo (Atlas).
- [ ] **DocuSign de produção** (HMAC, replay, dedupe, PDF privado) e **SMTP de incidentes** com test fire sem PII.

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

## D. Banco, observabilidade e volta

- [ ] Migrations aditivas e idempotentes, ensaiadas em banco descartável e em branch Neon de dev; **`prisma migrate deploy` de produção roda no build da Vercel**, então todo build de Preview contra o banco de produção aplica migration: o Preview precisa de banco próprio antes de mainnet.
- [ ] Ponto de restauração (PITR/branch) do Neon criado e a hora anotada **antes** do deploy.
- [ ] Alertas ativos com test fire: submit on-chain falho, NAV × supply, webhook rejeitado, taxa de erro em `/api/investidor`, Pix de saída incerto.
- [ ] Jobs agendados (`OPS_SCHEDULE_ENABLED`, `OPS_CRON_SECRET`) rodando só no repositório de produção; monitor de snapshot (< 26 h).
- [ ] Rollback: desligar `MAINNET_ENABLED`, promover o deploy anterior (só Thais), reconciliar por hash antes de repetir qualquer operação; nunca retransmitir tx.

## E. Horizon em fim de vida e reset trimestral da testnet

- [ ] Horizon mantido no D30 (indisponível ou divergente = fail-closed, sem fallback para Postgres); ADR pós-D30 com indexador/Hubble; owner e prazo para os anúncios da SDF. Detalhe: `instaward2-cutover.md` §5.
- [ ] Reset trimestral da testnet (congelar evidências, novas contas e asset, reaplicar flags do issuer, rodar o ciclo duas vezes, revogar credenciais antigas). Detalhe: `instaward2-cutover.md` §6.

## F. Go/no-go (somente Thais)

1. Todos os itens **P0** da seção A marcados, com evidência; P1 resolvidos ou aceitos por escrito (Argus + Atlas).
2. Aceites: Vera (gates no mesmo SHA), Consuelo (domínio/NAV), Argus (dinheiro, assinatura, auth, flags, PII), Atlas (final).
3. Thais conduz o go/no-go com Atlas, Argus e os contatos dos fornecedores; liga `MAINNET_ENABLED` na menor exposição prevista.
4. Qualquer incidente: seção D, rollback.
