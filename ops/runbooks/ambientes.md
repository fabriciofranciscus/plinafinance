# Ambientes: produção × dev (banco, Vercel e scripts)

Estado em 2026-11-13. Decisão do Atlas e da Thais: o banco da produção e o de dev são **bancos separados**.
Este runbook diz qual é qual, a regra que nunca se quebra e como provar a separação. Nenhum valor de
secret aparece aqui; o agente confere só **host (prefixo `ep-…`) e nomes**.

## 1. Mapa

| Ambiente | Quem usa | Branch Neon | Host (prefixo) | Quem altera |
|---|---|---|---|---|
| **Produção** | deploy da `main` na Vercel (Production), integração Neon | `main` | `ep-lucky-breeze-…` | só o **deploy da `main`** (a Thais promove) |
| **Dev** | Preview da Vercel, Development, `.env.local` de todos os worktrees, scripts e testes de integração | `dev` | `ep-rough-violet-…` (projeto `br-falling-darkness`) | build de Preview (`migrate deploy`), scripts e migrations de ensaio |

- A integração Neon da Vercel está conectada **só em Production**. Preview e Development têm as variáveis
  de banco (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_*`, `PG*`) apontadas para o `dev`.
- O branch `dev` nasceu como cópia da produção (ressincronizado em 2026-11-13 18:38). Depois disso diverge:
  dados e migrations de dev **não** voltam para a produção.
- Variáveis de banco **por branch** do Preview (ex.: as da `feat/m3-anchor-org-webhook`, que apontavam para
  a produção) foram removidas em 2026-11-13. Não crie variável de banco escopada a uma branch: o Preview
  genérico já aponta para o dev.

## 2. Regras

1. **Produção só muda por deploy da `main`.** Migration, seed, script e `prisma:deploy` nunca rodam à mão
   contra a produção. Exceção só com decisão escrita do Atlas, registrada no mural (a de 2026-11-13, o
   `ALTER TYPE` do TES-3, foi a última).
2. **Script nunca com o host `ep-lucky-breeze`.** Antes de rodar qualquer script ou migration, confira o host
   sem imprimir a URL:
   ```bash
   grep -E '^(DATABASE_URL|DIRECT_URL)=' .env.local | grep -o 'ep-[a-z0-9-]*' | sort -u
   ```
   O resultado tem de ser só `ep-rough-violet-…`; as duas variantes (`ep-rough-violet-…` e `ep-rough-violet-…-pooler`) são esperadas, uma por variável. Se aparecer `ep-lucky-breeze`, **pare**.
3. `.env.local` é gerado do ambiente **Development** (dev). Não copie variável de Production para ele.
4. Teste de banco (Vitest com `-pg`) usa Postgres **local descartável**, nunca o dev nem a produção.
5. Todo build de Preview roda `prisma migrate deploy` (ver `vercel.json`) no `dev`. Isso é o ensaio da
   migration antes da produção: migration que quebra no Preview não chega à `main`.

## 3. Prova de que o Preview migra o dev e não a produção (1º preview do ponto (d))

O ponto (d) traz 5 migrations novas (3 do E2-6: `resgate_cotacao`, `resgate_orfa_prova`, `resgate_cotacao_fk`;
2 do DS, já aplicadas à mão nos dois bancos com o mesmo checksum) e a do TES-3
(`20261113100000_audit_tesouraria_excesso_queimada`, valor de enum já criado à mão, `IF NOT EXISTS`).

Baseline antes do preview (leitura em 2026-11-13; produção por correspondência com o dev, ver nota): `_prisma_migrations`
com **47 linhas** = as **44** pastas de `prisma/migrations` da `main` (`4f337e8`) + **3** aplicadas à mão no banco
compartilhado antes da separação: `20261111020000_audit_tesouraria_legada_movida` (TES-2; a pasta existe só na
branch `feat/tes-2-registro-evento`, não na `main` nem no d-point) e as 2 do DS (`cessao_docusign_envio`,
`cessao_docusign_conclusao`). A última por nome é `20261112080000_acao_audit_reabertura_por_provedor`. Sem
`ResgateCotacao`. Linha sem pasta local não quebra o `migrate deploy`.

Alvo depois de o `migrate deploy` aplicar o d-point (50 pastas = 44 + 6 novas: 3 do E2-6, 2 do DS, 1 do TES-3):
**51 linhas** (as 47 + as 3 do E2-6 + a do TES-3; as 2 do DS já tinham linha e são puladas, a da TES-2
continua sem pasta), última por nome `20261113100000_audit_tesouraria_excesso_queimada`, `ResgateCotacao` presente.

Depois do 1º preview verde do d-point:

1. **Log de build do Preview** (Vercel → Deployments → preview → Build Logs): o `migrate deploy` roda com
   `DIRECT_URL="$DATABASE_URL_UNPOOLED"` (`vercel.json`), então a linha `Datasource "db" … at "ep-…"` tem de
   mostrar `ep-rough-violet-…` **sem** `-pooler`; e "The following migrations have been applied" lista as
   migrations novas.
2. **Dev avançou** (Farol, leitura, `.env.local`): `select count(*), max(migration_name) from
   _prisma_migrations;` → **51** e `20261113100000_audit_tesouraria_excesso_queimada`;
   `select to_regclass('"ResgateCotacao"')` não nulo.
3. **Produção NÃO avançou** (Thais ou Farol com leitura): mesma consulta no banco `ep-lucky-breeze` →
   continua **47** e sem `ResgateCotacao`, até o deploy da `main`. Sem acesso de leitura à produção, a
   evidência é o log do passo 1 (host de dev) mais a contagem inalterada no console do Neon.
4. Registre no mural: SHA do preview, host visto no log, contagens antes/depois.
5. Depois do deploy da `main` (Thais): a produção chega a **50 pastas / 51 linhas**, última
   `20261113100000_audit_tesouraria_excesso_queimada` com
   `checksum = 2078529094a573c26660d087d8a5a20a372c7711c7b9c6e4eef113d1baffffef` e `finished_at` preenchido.

Se o log do passo 1 mostrar `ep-lucky-breeze`: **interrompa**, não promova nada e chame o Atlas (o Preview
está apontado para a produção; corrigir as variáveis de Preview antes de qualquer outro build).

## 4. Ligar o agendamento (`OPS_SCHEDULE_ENABLED`) depois do deploy do ponto (d)

Os jobs do GitHub Actions (`ops-nav-snapshot`, `ops-emission-reconciliation`) só rodam com a variável do
repositório `OPS_SCHEDULE_ENABLED == 'true'` e chamam `https://plina.finance/api/ops/*` com `OPS_CRON_SECRET`.
Ligue **somente depois** do deploy do (d) e do ok da Thais: antes disso a rota `snapshot-nav` falha com
`SEM_TOKEN` (o `BLOB_READ_WRITE_TOKEN` de Production vale a partir desse deploy).

Pré-condições (conferir, nesta ordem):
- [ ] Deploy do ponto (d) em Production **READY**, feito pela Thais.
- [ ] `OPS_CRON_SECRET` existe como **Actions secret** em `ThaisFReis/Plina` e em Production na Vercel (o
      mesmo valor; conferido só por nome; o agente não lê o valor).
- [ ] `BLOB_READ_WRITE_TOKEN` existe em Production (store privado `plina-comprovantes`).
- [ ] `PIX_MAX_BRL` = 50000 em Production (variável comum).
- [ ] Em `fabriciofranciscus/plinafinance` a `OPS_SCHEDULE_ENABLED` fica ausente ou diferente de `true`
      (o repositório-fonte não duplica chamadas).

Passo da Thais (1 linha): em `ThaisFReis/Plina` → Settings → Secrets and variables → Actions → **Variables**
→ criar `OPS_SCHEDULE_ENABLED` = `true`.

Prova depois de ligar: Actions → "Daily NAV snapshot" → **Run workflow** (manual) → verde; o snapshot
aparece no Blob e `/api/pool/summary` segue respondendo. Se falhar, desligue a variável (apague ou `false`) e
chame o Farol. Rollback é só desligar a variável.
