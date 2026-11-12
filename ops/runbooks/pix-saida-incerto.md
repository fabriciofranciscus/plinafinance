# Pix de saída `INCERTO` — procedimento do operador

Use este runbook quando o alerta de `GET /api/ops/pix-saida` informar uma
cessão com pagamento `INCERTO`, valor divergente ou processamento antigo. A
regra principal é: **não reenvie**. O PSP pode ter recebido ou concluído o Pix.

## Guardas

- Não chame novamente a ação de pagar e não reabra a transferência.
- Não altere `TransferenciaPix`, `Pagamento` ou `EventoAudit` por SQL.
- Não cole chave Pix, CPF/CNPJ, segredo, resposta bruta do PSP ou comprovante
  em chat, mural, log ou arquivo compartilhado.
- `SIMULADO` e Asaas sandbox nunca provam pagamento em dinheiro. Em
  `STELLAR_NETWORK=PUBLIC`, ambos devem falhar com `PSP_CONFIG`.

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
persistida pelo serviço.

## 2. Conferir no painel do PSP

1. Entre no painel do ambiente correspondente: sandbox para testnet; produção
   somente quando o provedor de produção estiver aprovado.
2. Procure primeiro por `providerId`. Se estiver vazio, procure pela referência
   externa `idempotencyKey` e pela janela de `criadoEm`.
3. Confira status, valor, identificador E2E e comprovante. Guarde a evidência
   apenas no repositório restrito aprovado para operação; não a copie para o
   OpenBot.

## 3. Classificar sem escrever no banco

| Evidência do PSP | Decisão operacional agora |
|---|---|
| `DONE`/concluído, valor exato e comprovante/identificador E2E válidos | Elegível a `COMPROVADA`; deixe o varredor consultar e fechar. Se ele não convergir, abra incidente e mantenha a cessão bloqueada. |
| `FAILED`/cancelado com comprovante do PSP de que nada saiu | Elegível a `FALHOU`; deixe o varredor observar o estado. Se não convergir, abra incidente. |
| `DONE` sem valor, não encontrado, pendente, resposta ilegível ou painel indisponível | Permanece `INCERTO`; não reenvie e não reabra. |
| Valor diferente do pedido | Permanece `INCERTO` com severidade financeira; interrompa o fluxo e escale imediatamente. |

`COMPROVADA` ou `FALHOU` só são aceitas com evidência do PSP. Antes da ação
admin auditada planejada para depois do D30, nenhuma classificação manual vira
escrita no banco. O estado só muda pelo caminho automático já idempotente; se
esse caminho não convergir, o caso fica bloqueado em incidente.

## 4. Fechamento

- `COMPROVADA`: confirme que existe `Pagamento`, comprovante no Blob e âncora
  com hash correspondente antes de liberar a cessão.
- `FALHOU`: uma nova tentativa continua proibida sem a ação auditada e a regra
  de aprovação vigente. Trocar o destino exige dupla aprovação e fica para
  depois do D30.
- `INCERTO`: mantenha o alerta aberto e registre a próxima checagem no sistema
  restrito de incidentes, sem PII.

## Escalonamento

Escale imediatamente para Thais e Argus quando houver valor divergente, dúvida
de titularidade, evidência de pagamento duplicado ou divergência entre painel,
banco, comprovante, Blob ou âncora. Não faça compensação manual.
