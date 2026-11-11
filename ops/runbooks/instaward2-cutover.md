# Checklist de cutover — Instaward 2

Estado consolidado em 2026-11-11. Este checklist prepara a decisão; não autoriza deploy, promoção, DNS, WAF, Edge Config, migration nem transação em mainnet.

## 1. Gate do candidato

- [ ] Commit e tag assinada imutáveis, com os quatro gates verdes no mesmo SHA: `typecheck`, `test`, `lint:auth-guard` e `build`.
- [ ] Smoke E3-2 passa duas vezes em clone limpo, com recovery e idempotência por perna.
- [ ] Evidências E1-P e E3-1 contêm links públicos, arquivos e SHA-256 conferidos.
- [ ] Vera aprova; Consuelo aprova domínio/NAV; Argus aprova dinheiro, assinatura, auth, flags e PII; Atlas dá o aceite final.

## 2. Flags

| Flag | Testnet/demo | Primeiro deploy mainnet | Condição para ligar |
|---|---|---|---|
| `MAINNET_ENABLED` | `false` | `false` | última mudança do go/no-go; primeira no rollback |
| `M3_INSTITUTIONAL_GATING` | `true` só no ensaio aprovado | `false` | suitability, ticket e fase institucional aprovados |
| `INTL_INVESTOR_FLOW` | `false` | `false` | trilha internacional e compliance por jurisdição |
| `CUSTODY_PROVIDERS` | `false` | `false` | adapter real, política e revisão do Argus |
| `SOROBAN_WATERFALL` | `false` | `false` | contrato implementado, auditado e reconciliado |
| `BUYER_SELF_REALIZACAO` | `true` só no smoke aprovado | `false` | processo operacional e limites aprovados |
| `LAB_ENABLED` | `true` só em testnet controlada | `false` | nunca ligar em mainnet |

- [ ] Ausência, erro ou tipo inválido mantém todas as flags desligadas.
- [ ] Edge Config e env não divergem; qualquer `NEXT_PUBLIC_*` exige novo build.
- [ ] Inventário de write paths prova que nenhum caminho move valor fora dos guards.

## 3. Fornecedores e ambiente

- [ ] DocuSign sandbox: HMAC, replay, dedupe, PDF privado e hash do byte armazenado homologados.
- [ ] PSP regulado sandbox: conta da Thais, idempotência, comprovante privado e memo-hash homologados.
- [ ] Etherfuse: SLA, preço, limites, rail BR/PIX, ativo-ponte e contato de incidente confirmados por escrito.
- [ ] Vercel Blob privado: token separado por ambiente, acesso curto e revogação testados.
- [ ] Upstash: instâncias próprias de production/preview e rate-limit distribuído provado.
- [ ] SMTP de incidentes: test fire sem PII; falha do envio é observável e não vira sucesso.
- [ ] Neon: migrations aditivas/idempotentes ensaiadas em branch dev; `prisma migrate deploy` de produção fica para a Thais.
- [ ] `OPS_CRON_SECRET`: 64 hex gerados fora do repositório, mesmo valor no GitHub Secret e Vercel Production sensitive; nenhum agente lê o valor.

## 4. Ledger, custódia e NAV

- [ ] Issuer e distributor têm topologia multisig aprovada; uma seed isolada não assina mainnet.
- [ ] Recovery kit e rotação são restaurados de verdade em testnet.
- [ ] Política de clawback tem duas aprovações distintas, notificação auditável e hipótese restrita.
- [ ] TES-2 preserva o NAV; distributor fica sem PLINARF legado; registro e memo SHA-256 conferem.
- [ ] Snapshot diário só publica depois de `Σ trustlines autorizadas = circulante` por asset code.
- [ ] Alarme de emissão e reconciliação rodam a cada 10 min; `alerta: true` falha o job.
- [ ] Snapshot E3-1 é idempotente por data; reexecução não cria segunda âncora.
- [ ] O monitor de 10 min encontra um snapshot publicado há menos de 26 h; ausência, arquivo inválido ou idade maior/igual a 26 h falha o job mesmo se o agendamento diário não executou.

## 5. Horizon em fim de vida

- [ ] Manter Horizon no D30; indisponibilidade/divergência continua fail-closed, sem fallback para Postgres.
- [ ] Abrir ADR pós-D30 comparando Horizon com indexador/Hubble e soma verificável de trustlines.
- [ ] A ADR define atraso máximo, reconciliação, backfill, observabilidade, rollback e casos de saldo congelado/em trânsito.
- [ ] Monitorar anúncios da SDF com owner e prazo registrados.

## 6. Reset trimestral da testnet

- [ ] Congelar evidências do trimestre: issuer/distributor, flags, saldos, snapshot, hashes e commits — sem seeds, segredo ou PII.
- [ ] Criar novas contas testnet e novo asset; nunca reutilizar chaves de mainnet.
- [ ] Reaplicar flags `AUTH_REQUIRED`, `AUTH_REVOCABLE` e `AUTH_CLAWBACK_ENABLED`; conferir no explorer.
- [ ] Recriar trustlines e autorizações, contas patrocinadas e saldo TESOURO de sandbox.
- [ ] Atualizar somente envs de development/preview e webhooks sandbox; production permanece intocada.
- [ ] Rodar o ciclo completo duas vezes, inclusive recovery por perna, snapshot e alarmes.
- [ ] Revogar/remover credenciais testnet antigas após a evidência e registrar data, owner e resultado.

## 7. Execução e rollback — somente Thais

1. Thais congela o candidato e confere os aceites.
2. Thais configura mainnet com todas as flags desligadas e sem chave única de issuer/distributor.
3. O time executa smoke somente leitura e test fire dos alertas fora de produção.
4. Thais conduz go/no-go com Atlas, Argus e os contatos dos fornecedores.
5. Se aprovado, Thais liga `MAINNET_ENABLED` na menor exposição prevista.
6. Qualquer incidente: desligar `MAINNET_ENABLED`, reverter o deployment e reconciliar por hash antes de repetir operação.
