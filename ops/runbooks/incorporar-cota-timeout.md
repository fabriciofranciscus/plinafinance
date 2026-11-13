# Incorporar cota: TIMEOUT ou erro 500

Vale para a incorporação da cota (ação `incorporar-cota` do admin, em `/admin`, e a rota
`/api/admin/originacao`). Pedido do Argus; explicação técnica dada pelo Bento.

## Quando usar
A incorporação devolveu **TIMEOUT** ou **500** (ou a tela ficou sem resposta).

## O que fazer
1. **Chame de novo o MESMO `incorporar-cota` da MESMA cessão.** Nada além disso.
   A emissão pode já ter saído na rede; a nova chamada a recupera pelo memo e cria a Cota.
2. Espere a resposta. Enquanto a recuperação não conclui, o NAV pode ficar **indisponível**
   (`/api/pool/summary` responde 503). Isso é esperado; não é motivo para agir no ledger.
3. Confira que a Cota existe e que o `/api/pool/summary` voltou a responder.

## O que NUNCA fazer
- Recriar a cessão.
- Recriar o laudo.
- Refazer o Pix.
- Emitir de novo por fora do `incorporar-cota`.

Qualquer um desses pode duplicar o efeito de uma emissão que já saiu.

## Por quê
A âncora do registro roda dentro de uma transação de 120 s. No pior caso ela estoura **depois**
de a emissão ser submetida; só a Cota, o Movimento e o audit falham. Não há perda nem
duplicação de dinheiro. A correção estrutural é pós-D30. Comentário técnico em
`lib/services/tokenizacao.ts` (branch `fix/e1-p-comentario-ancora`, do Bento).

## Se a segunda chamada também falhar
Pare e chame o Atlas e o Bento. Guarde o `cessaoId` e o horário das tentativas. Não tente uma
terceira vez com outro caminho.

## Não verificado por mim (Farol)
O comportamento de recuperação pelo memo e a janela de 120 s vêm da descrição do Bento; não li
o código da branch dele. A Vera deve cobrir esse passo no ensaio da cota de prova.
