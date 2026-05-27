# Next steps

Pós-decomposição de `app/investir/page.tsx` (2.547L → 220L). Refator
puramente estrutural — comportamento preservado. Lista do que ainda
precisa ser feito agora que cada concern é testável isoladamente.

## Validação imediata

- [ ] Rodar E2E manual `/investir` no `pnpm dev`: golden path completo
      (welcome → identity → banking → quote → onramp → settling → claiming
      → confirm → receipt) com fluxo Privy real.
- [ ] Validar cenários sensíveis que motivaram o gate de race condition:
  - [ ] Digitar valor na quote e clicar "revisar" rapidamente — confirmar
        que `quoteGateRef` em `_hooks/use-quote.ts` descarta a resposta
        stale.
  - [ ] Branch mock do swap (`swap/build` retorna `mock: true`) — deve
        pular direto pro `receipt`.
  - [ ] "Comprar mais" no receipt — deve voltar pro `quote` sem resíduo
        de `buyResult/swapBuild/onRamp/quote`.
- [ ] Rodar a suíte E2E Playwright do investir
      (`*-full-flow.spec.ts`) com `NEXT_PUBLIC_E2E_PRIVY_STUB=true`.

## Testes unitários (agora possíveis)

Cada hook agora pode ser testado isoladamente com `renderHook` + mocks
de `fetch`/`signRawHash`. Prioridade dos hooks que protegem invariantes
de negócio:

- [x] `_hooks/use-quote.ts` — gate de race condition (screen != 'quote'
      OU onRampLoading=true → descarta resposta). Caso crítico já
      causou bug em produção (commit `0cc6a24`). **8 testes**
- [x] `_hooks/use-swap.ts` — branching mock/real + regra `onRampReady`
      (`completed || (processing && stellarClaimableBalanceId)`) +
      desvio pra `claiming` quando `claimableBalanceId && !claimTxHash`.
      **11 testes**
- [x] `_hooks/use-onramp.ts` — polling 3s no settling para quando
      `status === 'completed'` + cleanup `cancelled + clearInterval`.
      **10 testes**
- [x] `_hooks/use-trustlines.ts` — sequência PLINARF → TESOURO,
      idempotência via `trustlinesReady`, validação de shape do response
      do `/build`. **5 testes**
- [x] `_hooks/use-claim.ts` — build → sign → submit; propaga
      `claimTxHash` pro onRamp via `applyClaimTxHash`. **6 testes**

Infra adicionada: `@testing-library/react` + `jsdom` em devDeps,
`vitest.config.ts` inclui `app/**/__tests__/**/*.test.{ts,tsx}`,
arquivos usam `// @vitest-environment jsdom` per-file.

## Limpeza / dívidas remanescentes

- [ ] Avaliar se o `onRampLoading` lifted-state no orquestrador pode ser
      simplificado. Hoje vive em `use-investir-flow.ts` e é injetado em
      `use-quote` (leitor) e `use-onramp` (escritor) — funciona, mas é
      acoplamento por estado em vez de evento.
- [ ] `_components/screens/welcome.tsx` ainda traz a lógica do Privy
      email/OAuth inline (state machine local). Faz sentido isolar num
      `_hooks/use-welcome-auth.ts` se aparecerem variações (ex: SSO
      institucional).
- [ ] `_components/shared/onboarding-progress.tsx` tem fake-progress
      (setTimeout). Substituir por progresso real do `runOnboard` quando
      o handler expuser fases intermediárias.

## Replicar padrão em outros fluxos

`sacar/page.tsx` (441L, 19 hooks) é o próximo candidato natural — mesmo
shape (auth + KYC + banking + signing) e já compartilha vocabulário com
`investir`. Outros (`comprar`, `vender` em ~330L) ainda não justificam o
custo do refator.

- [ ] Decompor `app/sacar/page.tsx` reusando o padrão de
      `_hooks/_components/_lib/_types` estabelecido aqui.
- [ ] Considerar elevar primitivas duplicáveis (`DataRow`, `TxRow`,
      `Term`, `TestnetBanner`, `ErrorBlock`) pra `components/ui/` se
      `sacar` consumir as mesmas.
