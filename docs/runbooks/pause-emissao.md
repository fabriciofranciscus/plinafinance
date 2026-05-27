# Runbook — Pause Emissão

> Toggle de kill-switch quando há incident upstream (Etherfuse, Fireblocks, PSP)
> ou quando se prepara para clawback/maintenance.

## Gatilho
- Etherfuse caiu OU
- Fireblocks bloqueia signing OU
- PSP Pix rejeitando OU
- Maintenance programada OU
- Em sequência com `clawback.md`.

## Pré-checks
- [ ] Confirmar incident (não pause por engano).
- [ ] Notificar CEO + CTO via canal de incident.

## Procedimento
1. `vercel env edit MAINNET_ENABLED=false` (Edge Config) — efeito propaga em ~30s.
2. Invalidate cache: `vercel revalidate /investir /sacar`.
3. Banner em `/investir`: "emissão temporariamente pausada".
4. Stop dos cron jobs (`vercel cron pause nav-snapshot` etc).

## Rollback
1. Confirmar resolução do incident upstream.
2. `vercel env edit MAINNET_ENABLED=true`.
3. Smoke test: 1 quote + 1 onramp em staging mirror.
4. Remove banner.

## Pós-mortem (template)
- Gatilho · Duração · Investidores afetados · Pagamentos em fila · Mitigação.
