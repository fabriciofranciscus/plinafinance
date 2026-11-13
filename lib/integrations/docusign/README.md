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
| `buscarEnvelopePorTransactionId(transactionId)` | `envelopeId` já criado ou `null` (consulta `GET /envelopes?transaction_ids=`) |
| `criarEnvelope({ documentoPdf, nomeDocumento, signatario: { nome, email }, emailSubject, transactionId, posicaoAssinatura? })` | `{ envelopeId }` (envio por e-mail, status `sent`, sem `clientUserId`) |
| `transactionIdDeterministico(chaveDeNegocio)` | GUID estável para usar como `transactionId` |
| `obterStatusEnvelope(envelopeId)` | `criado` · `enviado` · `entregue` · `assinado` · `concluido` · `recusado` · `anulado` · `desconhecido` |
| `baixarDocumentoAssinado(envelopeId)` | `Buffer` (PDF combinado) |
| `verificarHmacConnect(rawBody, headers, chave)` | `boolean` (HMAC-SHA256, tempo constante; aceita qualquer `X-DocuSign-Signature-N`) |

## Idempotência da criação

`transactionId` é obrigatório (GUID); o chamador deriva o id de uma chave de negócio estável
(`transactionIdDeterministico(\`cessao:${id}\`)`, nunca PII) e o grava ANTES do POST.

Medido no sandbox (2026-11-10):
- dois POSTs **sequenciais** com a mesma `transactionId` devolvem o **mesmo** envelope (201), sem 2º e-mail;
- dois POSTs **simultâneos** não têm resposta garantida (um voltou 201 sem `envelopeId`), mas não duplicaram;
- `GET /envelopes?transaction_ids=<id>&from_date=…` encontra o envelope (0 quando não existe).

Por isso: nunca dispare dois `criarEnvelope` em paralelo para a mesma operação; um 2xx sem `envelopeId`
é recuperado pela consulta; rede, timeout, 429 e 5xx no POST viram `RESULTADO_INCERTO` — chame
`buscarEnvelopePorTransactionId` com a MESMA `transactionId` e só reenvie (com a mesma) se vier `null`.
O dedupe é por janela limitada na DocuSign (~7 dias, doc.); não reuse a chave para outro envelope.

## Download

`documents/combined` NÃO devolve bytes idênticos em downloads diferentes (medido). Quem ancorar hash
(DS3) deve guardar os bytes baixados junto do hash.

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
| `DOCUSIGN_CONNECT_HMAC_KEY` | chave do Connect; `POST /api/webhooks/docusign` (DS3) responde 503 sem ela. Valor não existe ainda no `.env.local` — registrar o Connect no sandbox e pôr a chave (Farol/Thais) |

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

## DS2/DS3 — uso pela cessão (medido em testes com DocuSign simulado; smoke sandbox do DS2: envelope criado, reenvio devolve o mesmo)
- `registrarCessao` → `enviarCessaoParaAssinatura` (`lib/services/cessao-docusign.ts`): `ENVIADA_DOCUSIGN`, sem memo.
- Webhook/polling → `processarEnvelopeDocusign` (`lib/services/cessao-assinatura.ts`): status relido na API; PDF baixado UMA vez e guardado (Blob privado `cessoes/<id>/assinada.pdf`, sem sobrescrita); `hashDocumento` = SHA-256 dos bytes guardados; memo = esse hash; só então `ASSINADA`.
- Não verificado: Connect real entregando no sandbox; Blob real (sem `BLOB_READ_WRITE_TOKEN` o armazenamento falha fechado); âncora real contra a testnet com um PDF assinado de verdade (o DS3 usa `ancorarSha256` da Estela com `desde` = `Cessao.criadaEm`; testada só com mock).
