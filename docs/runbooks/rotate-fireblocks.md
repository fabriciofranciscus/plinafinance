# Runbook — Rotate Fireblocks Keys

> Rotação programada (trimestral) ou emergencial (compromise suspeito).

## Gatilho
- Rotação trimestral programada OU
- Suspeita de compromise (acesso indevido ao Fireblocks console) OU
- Funcionário com acesso saiu da Plina OU
- Auditoria identificou key staleness.

## Pré-checks
- [ ] Janela de manutenção comunicada (≥ 24h antes, exceto emergência).
- [ ] Pause emissão (`pause-emissao.md`).
- [ ] Backup de policy engine + lista de approvers atual.

## Procedimento
1. Console Fireblocks → criar nova vault account `plina-issuer-vN+1`.
2. Configurar policy engine na nova vault (idêntico à anterior).
3. Approvers fazem co-sign de criação de nova issuing key.
4. Stellar: emitir tx `setOptions` no issuer adicionando nova key como signer (threshold N+1).
5. Wait 2 ledgers; remover key antiga via segunda `setOptions`.
6. Update `lib/integrations/fireblocks/` config pra apontar pra nova vault.
7. Deploy + smoke test.

## Rollback
- Re-add key antiga via `setOptions` se nova key falha.
- Manter key antiga como backup signer por 24h após rotação.

## Pós-mortem (template)
- Tipo (programada/emergencial) · Tempo total · Co-signs · Smoke test · Próxima rotação agendada.
