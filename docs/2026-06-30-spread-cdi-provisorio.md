# Decisão provisória: spread sobre CDI/SOFR (yield-alvo Sênior)

Status: **PROVISÓRIO — não implementado em código.** Revisitar antes de qualquer
implementação do componente `spread_curva_yield_pool` em
`lib/services/originacao.ts:gerarOferta` (ver PRD §3.4).

## Contexto

O PRD (`docs/PRD-plina-v1.md:301`, `:343-352`) define que o deságio pago ao
vendedor inclui um `spread_curva_yield_pool`, derivado do yield-alvo prometido
à classe Sênior (`CDI + x%` BR / `SOFR + y%` internacional). O valor de `x`/`y`
está marcado no PRD como "calibrado por safra do pool" e pendente de
confirmação com o CEO (PRD linha 303) — ou seja, nunca foi fixado.

Não dá pra calibrar esse número com precisão hoje porque depende de:
1. Resultado do outreach institucional (Entregável 2 do Instawards — LOI/feedback
   de ticket e exigência de retorno).
2. Dados reais de inadimplência/prazo médio de realização, que só existirão
   depois de operação em produção.

## Números provisórios (ponto de partida, não calibração final)

| Classe | Yield-alvo provisório | Faixa de segurança |
|---|---|---|
| Sênior BR (PLINARFS) | CDI + 5% | CDI + 4% a CDI + 7% |
| Internacional | SOFR + 7% | SOFR + 6% a SOFR + 9% |

### Racional
- Comparáveis de FIDC brasileiro (cota sênior, originador novo/sem rating):
  CDI + 3% a CDI + 6%.
- Mercado informal de antecipação de cartas contempladas: deságios de 15–30%
  do valor de face, implicando taxas anualizadas bem acima de CDI.
- Crédito EM via rail cripto/Stellar sem rating: comparáveis rodam
  SOFR + 8% a SOFR + 12%.
- Pende-se para o lado conservador (spread mais alto) porque: (a) a Plina não
  tem track record ainda, (b) é mais fácil baixar o yield prometido depois com
  dados reais do que subir depois de já ter prometido pouco, (c) precisa sobrar
  margem operacional da Plina (PRD linha 354) além do spread Sênior.

## Quando revisitar

- Após o Entregável 2 (outreach institucional) trazer feedback real de ticket/
  exigência de retorno dos primeiros investidores.
- Após confirmação do CEO sobre mix-alvo Sênior/Subordinada (PRD linha 303).
- Antes de qualquer implementação de `spread_curva_yield_pool` no motor de
  precificação do vendedor (`lib/services/originacao.ts`).
