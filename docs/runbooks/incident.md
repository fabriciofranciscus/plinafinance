# Runbook — Incident Response (genérico)

> Template para qualquer incident não coberto por runbook específico.

## Severidades
- **SEV1** — fundos em risco, dados PII expostos, mainnet down.
- **SEV2** — funcionalidade core degradada, partial outage.
- **SEV3** — bug não-crítico, latência elevada.

## Procedimento (todos)
1. **Triage** (15 min): IC (Incident Commander = CTO ou on-call) declara severidade, abre canal `#inc-YYYYMMDD-<slug>`.
2. **Contain** (depende): pause emissão se SEV1 com risco financeiro.
3. **Diagnose**: traces (Datadog), logs (Vercel), Stellar Expert, Etherfuse status.
4. **Mitigate**: workaround (feature flag, rollback Vercel, manual ops).
5. **Resolve**: fix verificado em staging → deploy → smoke test.
6. **Comm** (SEV1/SEV2): status page + email aos afetados (≤ 2h).

## Quem é envolvido por severidade
- **SEV1**: IC + CTO + CEO + jurídico + DPO (se PII).
- **SEV2**: IC + CTO.
- **SEV3**: IC.

## Pós-mortem (template)
- Timeline · Causa raiz (5 whys) · Impacto · Mitigação · Action items com owner + deadline · Lessons learned.
