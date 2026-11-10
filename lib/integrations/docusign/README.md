# DocuSign — assinatura digital (sandbox)

Cliente de integração (M2 / Instaward 2). Usa só `node:crypto` + `fetch`, sem SDK de
terceiro. `lib/services` importa **apenas** de `lib/integrations/docusign` (`index.ts`).

> Esta pasta cobre só o cliente. Ligar ao serviço de originação (trocar o stub
> `docusignEnvelopeId: 'mvp-stub:…'`) é a DS2; a rota de webhook do Connect é a DS3.

## Sandbox não exige conta PJ nem e-CPF

A conta de desenvolvedor (demo) é gratuita e a assinatura nela não tem valor jurídico.
Conta empresarial e e-CPF da Plina só valem para **produção** (trilha A do PRD) e ficam
fora do Instaward 2. Integrações só em sandbox.

## Funções

| Função | Retorno |
|---|---|
| `obterTokenDocusign()` | token JWT (cache até ~5 min antes de expirar) |
| `criarEnvelope({ documentoPdf, nomeDocumento, signatario: { nome, email }, emailSubject, transactionId, posicaoAssinatura? })` | `{ envelopeId }` (envio por e-mail, status `sent`, sem `clientUserId`) |
| `transactionIdDeterministico(chaveDeNegocio)` | GUID estável para usar como `transactionId` |
| `obterStatusEnvelope(envelopeId)` | `criado` · `enviado` · `entregue` · `assinado` · `concluido` · `recusado` · `anulado` · `desconhecido` |
| `baixarDocumentoAssinado(envelopeId)` | `Buffer` (PDF combinado) |
| `verificarHmacConnect(rawBody, headers, chave)` | `boolean` (HMAC-SHA256, tempo constante; aceita qualquer `X-DocuSign-Signature-N`) |

## Idempotência da criação

`transactionId` é obrigatório (GUID). A DocuSign devolve o **mesmo** envelope para a mesma
`transactionId`, então o chamador deriva o id de uma chave de negócio estável
(`transactionIdDeterministico(\`cessao:${id}\`)`, nunca PII) e o grava/reusa em qualquer retry.
Rede, timeout, 429 e 5xx no POST viram `RESULTADO_INCERTO`: repita com a MESMA `transactionId`;
não gere outra. O smoke prova isso no sandbox (reenvio devolve o mesmo envelope).

`criarClienteDocusign({ env, fetchImpl, agora })` cria uma instância isolada (testes).

Erros são `DocusignError` com `codigo` e mensagem em português, sem corpo de resposta, token,
chave nem dados do signatário. `consent_required` vira `DocusignConsentRequiredError`.

## Ambiente

| Variável | Conteúdo |
|---|---|
| `DOCUSIGN_INTEGRATION_KEY` | client_id (GUID) |
| `DOCUSIGN_USER_ID` | `sub` do JWT (GUID) |
| `DOCUSIGN_ACCOUNT_ID` | GUID da conta |
| `DOCUSIGN_BASE_URI` | `https://demo.docusign.net` (API em `${BASE_URI}/restapi/v2.1`) |
| `DOCUSIGN_PRIVATE_KEY` | corpo base64 da chave RSA, uma linha, sem `BEGIN/END` (PKCS#1; fallback PKCS#8) |
| `DOCUSIGN_OAUTH_BASE` | opcional no sandbox (default `account-d.docusign.com`); **obrigatória** com qualquer outro `BASE_URI` (falha fechado) |
| `DOCUSIGN_CONNECT_HMAC_KEY` | chave do Connect (DS3; ainda não existe) |

`DOCUSIGN_PUBLIC_KEY` não é usada. Nunca logar valores: spans e erros levam só nomes.

## Consentimento

O app é "Private custom integration" com JWT Grant. O usuário de `DOCUSIGN_USER_ID` precisa
ter concedido o escopo `signature impersonation`; sem isso o token falha com
`CONSENTIMENTO_NECESSARIO`. Conceda em Apps and Keys do painel do sandbox.

## Posição da assinatura

`criarEnvelope` coloca um campo "assine aqui" em posição fixa (padrão: página 1, x=72, y=700,
em pontos a partir do canto superior esquerdo). A DS2 ajusta por documento via
`posicaoAssinatura` (ou migra para âncora de texto quando o template existir).

## Smoke

```bash
pnpm smoke:docusign signatario@exemplo.com [nome]
```

Pede o token, cria um envelope com um PDF "MINUTA – TESTNET" e imprime `envelopeId` e status.
O signatário recebe o e-mail de verdade. Testes: `__tests__/integrations/docusign.test.ts`.

## Templates previstos (PRD)

- **M1** — Termo de Cessão de Direitos Creditórios (cedente).
- **M2** — Termo de Cessão Plina → Comprador.
- **M3** — Termo de Adesão FIDC PLINA-RF.

Ver `docs/PRD-plina-v1.md` §M1 (F-M1-1, F-M1-6), §M2 (F-M2-3), §M3 (F-M3-7).
