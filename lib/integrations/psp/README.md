# PSP — Pix de SAÍDA ao titular (E1-2)

Contrato: `contratos/2026-11-11-e1-2-psp-pix-saida.md` (Plina-wt/backend2, `~/OpenBot/Shared/plina`).

A porta `PixProvider` (`types.ts`) paga o titular (cedente) por Pix de saída; não é cobrança. Provedores:

| Arquivo | Provedor | Quando |
|---|---|---|
| `asaas.ts` | Asaas, **só sandbox** (`https://api-sandbox.asaas.com`, fixo por código) | `PSP_PROVIDER=ASAAS` + `ASAAS_API_KEY` |
| `simulado.ts` | simulado, sem dinheiro nem rede | padrão (`PSP_PROVIDER` ausente) |

Seletor: `obterPixProvider()` (`index.ts`); valor desconhecido → `PSP_CONFIG`, nunca cai em outro provedor.

**O Asaas não tem idempotência no POST nem filtro por `externalReference`.** Por isso o serviço
(`lib/services/liquidacao-cedente.ts`) grava o claim antes de falar com o PSP, usa a `idempotencyKey`
(`pix-cedente:<cessaoId>`) como `externalReference` e **nunca reenvia sozinho** após resposta ambígua: só tenta achar a
transferência (`localizarPorChave`). Reenvio é decisão do operador.

`comprovante.ts` monta o comprovante canônico (RFC 8785, sem PII, destino mascarado). O SHA-256 dele é o Memo.hash da
âncora (`ancorarSha256`, contexto `COMPROVANTE_PIX`). A chave Pix do titular nunca é gravada.

Sandbox Asaas (doc): chaves `cliente-a00001@pix.bcb.gov.br` … `a00005` simulam Pix concluído.
Smoke: `scripts/smoke-pix-saida.ts` (testnet + Neon dev, provedor simulado).
