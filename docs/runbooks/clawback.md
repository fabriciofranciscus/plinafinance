# Runbook — Execução de Clawback

> Ver PRD §4 e whitepaper §6.5. Hipóteses exclusivas: `DECISAO_JUDICIAL`,
> `SANCAO_REGULATORIA`, `FRAUDE_DOCUMENTAL`, `ERRO_OPERACIONAL`.

## Gatilho
- Decisão judicial recebida pelo jurídico **OU**
- Sanção regulatória notificada (CVM, BACEN, OFAC) **OU**
- Fraude documental confirmada por compliance **OU**
- Erro operacional identificado por ops + CTO.

## Pré-checks
- [ ] Hipótese registrada por escrito (decisão, ofício, ticket de fraude, RCA).
- [ ] Aprovação dupla: jurídico + CTO.
- [ ] `Investidor.id` e `HoldingPLINARF` alvo identificados.
- [ ] Saldo on-chain confirmado via Stellar Expert.

## Procedimento
1. Pause emissão (ver `pause-emissao.md`) — opcional, mas recomendado.
2. Executar clawback via admin endpoint (`/api/admin/clawback`, a implementar em M0).
3. Registrar `EventoAudit.CLAWBACK_EXECUTADO` com `motivoClawback` + hash do documento legal.
4. Email pro investidor afetado + CC jurídico.

## Rollback
- Clawback é **irreversível** on-chain.
- Se executado por erro: emitir novos tokens via distributor pra restaurar holding (registra `EventoAudit.CLAWBACK_REVERTIDO_VIA_REEMISSAO`).

## Pós-mortem (template)
- Hipótese acionada · Documento legal · Decisão dupla · Tx hash · Tempo total · Lições.
