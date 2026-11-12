# Pix de saída `INCERTO` — procedimento do operador

Use a seção 0 antes do primeiro pagamento ou de qualquer reabertura. Use as
demais seções quando o alerta de `GET /api/ops/pix-saida` informar uma cessão
com pagamento `INCERTO`, valor divergente ou processamento antigo. A regra
principal é: **não reenvie**. O PSP pode ter recebido ou concluído o Pix.

## 0. Conferir titular antes de pagar ou reabrir

1. No sistema restrito de operação, abra o laudo de validação da cota e o
   cadastro do cedente da mesma cessão.
2. Compare os dígitos normalizados do CPF/CNPJ do titular confirmado no laudo
   com os do cadastro. Não copie nem exponha o documento durante a conferência.
3. Se faltar documento, o titular não estiver confirmado, houver divergência,
   ou o caso envolver espólio, cotitularidade ou procurador, **não pague nem
   reabra**: encaminhe para tratamento manual.
4. Se coincidir, registre a conferência em `EventoAudit` pela ação aprovada do
   aplicativo, antes de pagar/reabrir: `cessaoId`, resultado, referência do
   laudo, operador e horário. Não grave CPF/CNPJ, chave Pix, imagem ou trecho do
   laudo no evento. Se a ação auditada não estiver disponível, pare; não use
   SQL para suprir o registro.

Essa conferência manual é temporária. O HMAC versionado do titular do laudo é
pré-requisito pós-D30 para habilitar PSP de produção ou retirar a recusa em
`STELLAR_NETWORK=PUBLIC`.

## Guardas

- Não chame novamente a ação de pagar e não reabra a transferência.
- Não altere `TransferenciaPix`, `Pagamento` ou `EventoAudit` por SQL.
- Não cole chave Pix, CPF/CNPJ, segredo, resposta bruta do PSP ou comprovante
  em chat, mural, log ou arquivo compartilhado.
- `SIMULADO` e Asaas sandbox nunca provam pagamento em dinheiro. Em
  `STELLAR_NETWORK=PUBLIC`, ambos devem falhar com `PSP_CONFIG`.
- Até o D30, todo ambiente que gera evidência do SOW usa
  `PSP_PROVIDER=SIMULADO`. Não ative `ASAAS` antes do rótulo `PIX_SANDBOX`;
  se a conta sandbox for criada antes, avise o Atlas sem trocar o provedor.

## 1. Identificar a tentativa, somente leitura

O alerta contém apenas o `cessaoId`. No ambiente correto, confirme primeiro o
host do banco pelo inventário aprovado e execute uma consulta somente leitura:

```sql
BEGIN READ ONLY;
SELECT "cessaoId", "status", "provedor", "providerId", "idempotencyKey",
       "valor", "motivoFalha", "tentativa", "criadoEm", "atualizadoEm"
  FROM "TransferenciaPix"
 WHERE "cessaoId" = '<CESSAO_ID_DO_ALERTA>';
ROLLBACK;
```

Pare se não houver exatamente uma linha, se o ambiente estiver incerto ou se o
estado já for terminal. Não consulte nem exponha a chave Pix; ela não é
persistida pelo serviço. Confirme que `idempotencyKey` é exatamente
`pix-cedente:<cessaoId>`; divergência de referência é incidente e bloqueia a
classificação.

## 2. Conferir duas fontes independentes

1. Consulte a API do PSP pela referência externa exata
   `pix-cedente:<cessaoId>`. Use `providerId` apenas como confirmação adicional;
   não troque a referência por busca manual de destinatário.
2. No mesmo ambiente, consulte o extrato da conta de liquidação no intervalo
   entre `criadoEm` e o horário atual, procurando débito, estorno ou lançamento
   pendente com a mesma referência e o mesmo valor.
3. Confira nas duas fontes status, valor, identificador E2E e comprovante. A
   API pode continuar pendente sem que exista débito no extrato; ausência em
   uma só fonte não prova falha.
4. Registre em `EventoAudit`, pela ação aprovada, o resultado da API e do
   extrato e as referências/hashes das duas evidências. Guarde o material apenas
   no repositório restrito de operação; não grave resposta bruta ou PII no
   evento e não copie evidência para o OpenBot.

## 3. Classificar sem escrever no banco

| API do PSP + extrato | Decisão operacional agora |
|---|---|
| API `DONE`/concluído, valor exato e comprovante/identificador E2E válidos; extrato confirma o débito correspondente | Elegível a `COMPROVADA`; deixe o varredor consultar e fechar. Se ele não convergir, abra incidente e mantenha a cessão bloqueada. |
| Após 24 h, API não registra transferência concluída e extrato não contém débito nem lançamento pendente correspondente | Elegível a `FALHOU` somente pela ação auditada e com dupla aprovação de Thais e Atlas. |
| API pendente/não encontrada, extrato sem débito, prazo menor que 24 h, resposta ilegível ou qualquer fonte indisponível | Permanece `INCERTO`; não reenvie e não reabra. |
| API e extrato divergem | Permanece `INCERTO` com severidade financeira; interrompa o fluxo e escale imediatamente. |
| Valor diferente do pedido | Permanece `INCERTO` com severidade financeira; interrompa o fluxo e escale imediatamente. |

`COMPROVADA` ou `FALHOU` só são aceitas com as duas fontes. A ação admin
auditada, planejada para depois do D30, deve validar que os dois resultados já
estão em `EventoAudit`, com suas referências de evidência, **antes** de colher
a dupla aprovação. Não grave resposta bruta, CPF/CNPJ ou chave Pix no evento.
Até essa ação existir, nenhuma classificação manual vira escrita no banco: o
caso permanece bloqueado em incidente.

## 4. Fechamento

- `COMPROVADA`: confirme que existe `Pagamento`, comprovante no Blob e âncora
  com hash correspondente antes de liberar a cessão.
- `FALHOU`: uma nova tentativa continua proibida sem a ação auditada, as duas
  evidências registradas e a dupla aprovação de Thais e Atlas. Trocar o destino
  exige um fluxo próprio e fica para depois do D30.
- `INCERTO`: mantenha o alerta aberto e registre a próxima checagem no sistema
  restrito de incidentes, sem PII.

## Escalonamento

Escale imediatamente para Thais e Argus quando houver valor divergente, dúvida
de titularidade, evidência de pagamento duplicado ou divergência entre painel,
banco, comprovante, Blob ou âncora. Não faça compensação manual.
