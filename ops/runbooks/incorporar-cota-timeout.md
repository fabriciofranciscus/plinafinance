# Incorporar cota: TIMEOUT ou erro 500

Vale para a incorporação da cota (ação `incorporar-cota` do admin, em `/admin`, e a rota
`/api/admin/originacao`). Pedido do Argus; explicação técnica dada pelo Bento. Hoje é o caminho
de **testnet** (a transação de 120 s é uma exceção registrada de testnet; o desenho de mainnet
é outro e será refeito antes do M6).

## Quando usar
A incorporação devolveu **TIMEOUT** ou **500** (ou a tela ficou sem resposta).

## O que fazer
1. **Chame de novo o MESMO `incorporar-cota` da MESMA cessão.** Nada além disso.
   A emissão pode já ter saído na rede; a nova chamada a recupera e cria a Cota (a recuperação
   usa a tentativa de emissão guardada e, sem ela, o memo da transação). Se a primeira chamada
   ainda estiver rodando, a segunda espera na fila e não emite de novo.
2. Leia a resposta da segunda chamada:
   - **200**: recuperou. Vá ao passo 3.
   - **409 `EMISSAO_EM_ANDAMENTO`**: **não é falha.** A rede ainda não confirmou; nada foi gravado
     e nenhuma transação nova foi criada. Espere até o horário que a mensagem informa (a janela é
     de cerca de 2 minutos) e chame de novo o mesmo `incorporar-cota`.
   - **409 `ANCORA_INCORPORACAO_FALHOU`**: o registro da incorporação não foi ancorado e nada foi
     emitido. Chame de novo.
   - **409 `EMISSAO_FALHOU`**: a rede recusou; nada foi gravado. Uma nova chamada já pode ser feita.
3. Enquanto a recuperação não conclui, o NAV fica **indisponível** (`/api/pool/summary` responde
   503). Isso é esperado; não é motivo para agir no ledger. Ao concluir, confira que a Cota
   existe e que o `/api/pool/summary` voltou a responder. Quando o E1-P estiver na main, rode
   também `pnpm evidencia:cota <cotaId>` (testnet): os cinco passos precisam conferir.

## O que NUNCA fazer
- Recriar a cessão: muda a chave da incorporação, então não recupera a emissão que saiu (o gate do
  NAV a barra enquanto a tentativa anterior estiver pendente).
- Recriar o laudo.
- Refazer o Pix: pagaria o cedente de novo.
- Emitir de novo por fora do `incorporar-cota`.

## Por quê
A âncora do registro roda dentro de uma transação de 120 s. No pior caso ela estoura **depois**
de a emissão ser submetida; só a Cota, o Movimento e o audit falham. A tentativa de emissão
(guardada fora dessa transação) fica pendente e mantém o NAV indisponível até a recuperação
aplicá-la. Não há perda nem duplicação de dinheiro. A correção estrutural é pós-D30. Comentário
técnico em `lib/services/tokenizacao.ts`, junto da transação.

## Se a segunda chamada também falhar
"Falhar" é 500 ou TIMEOUT de novo, ou um 409 que não seja `EMISSAO_EM_ANDAMENTO` repetido por
mais de 5 minutos. Nesse caso pare e chame o Atlas e o Bento. Guarde o `cessaoId` e o horário das
tentativas. Não tente um caminho diferente.
