# Runbook — Mainnet Cutover (M9)

> Ver PRD §M9. Critério de "ready": 2 administradoras integradas, 3 prestadores
> formais contratados, 1 LOI institucional assinado, 30 dias testnet shadow-test
> sem incident crítico.

## Gatilho
- Checklist M9 100% assinado por CEO + CTO + jurídico.

## Pré-checks (50+ itens — overview; checklist completa em planilha)

### Regulatório
- [ ] FIDC registrado CVM 175.
- [ ] Administrador fiduciário ativo.
- [ ] Custodiante regulado CVM contratado.
- [ ] Auditor Big Four contratado.
- [ ] Parecer jurídico CVM 175 publicado.
- [ ] Carta CVM preparada (não enviada ainda).

### Técnico
- [ ] Issuer mainnet emitiu PLINARFS + PLINARFB com flags AUTH_REQUIRED+REVOCABLE+CLAWBACK.
- [ ] Fireblocks vault production ativa + policy engine validado.
- [ ] Privy production tenant (NÃO `PRIVY_VERIFY_STUB`).
- [ ] Edge Config `MAINNET_ENABLED=false` (toggle pós-canary).
- [ ] Vercel Rolling Releases configurado (10% → 50% → 100%).
- [ ] Status page público live.

### Ops
- [ ] Alarmes ativos: saldo issuer/distributor/funder.
- [ ] On-call rotation definida.
- [ ] Runbooks (clawback, pause, rotate, incident) revisados.

### Comunicação
- [ ] Email aos LOI investidores agendado.
- [ ] Press release em standby.

## Procedimento
1. Deploy production com `MAINNET_ENABLED=false`. Smoke test.
2. Toggle `MAINNET_ENABLED=true` apenas pra 10% via Rolling Release. **48h watch**.
3. Promote → 50%. **48h watch**.
4. Promote → 100%. Carta CVM enviada.
5. Email aos LOI: "onboarding mainnet aberto".
6. **Freeze de 2 semanas**: zero deploy não-emergencial.

## Rollback
- Toggle `MAINNET_ENABLED=false` (≤ 5 min).
- Vercel rollback pra release anterior.
- Banner em `/investir`: "mainnet em manutenção".

## Pós-mortem (template)
- Timeline canary · Incidents · Primeiro investidor mainnet onboard · NAV inicial · Lessons.
