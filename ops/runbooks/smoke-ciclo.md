# `pnpm smoke:ciclo` — o ciclo da Plina na testnet, em 1 comando

Para quem avalia: reproduz, com o código de produção, **originar → emitir → investir → resgatar → realizar** e imprime o
link do Stellar Expert de cada passo on-chain. Leva uns 3 minutos.

## O que precisa

- Node 22+ e `pnpm install` (o `postinstall` gera o Prisma Client).
- **Docker** (o smoke sobe um Postgres 17 descartável e o remove no fim). Sem Docker: suba um Postgres local **vazio** e passe
  `SMOKE_CICLO_PG_URL=postgresql://usuario:senha@127.0.0.1:PORTA/banco` (só host local é aceito).
- Internet (friendbot e Horizon da **testnet**).
- **Nenhuma chave, nenhum `.env.local`**: as contas (issuer, distributor, posição da Plina, investidor, emissor do ativo-ponte)
  são criadas novas na testnet a cada execução.

```bash
pnpm install
pnpm smoke:ciclo
```

## O que garante

- **Só testnet.** Recusa `STELLAR_NETWORK=PUBLIC`. **Nunca o Neon**: o banco é um contêiner local; qualquer outro host é recusado.
- **Pix de saída SIMULADO** (nenhum dinheiro, nenhum PSP). O comprovante é canônico, sem a chave Pix, e o SHA-256 dele é o
  `Memo.hash` de uma âncora na rede.
- **Sem dado pessoal na saída**: só ids, hashes e links. O CPF do cedente é sintético, gerado ao acaso, e nunca impresso.

## Os passos

| # | Perna | O que acontece | On-chain (link impresso) |
|---|---|---|---|
| 1 | Originar | cedente com KYC aprovado → lead → oferta → cessão → laudo → anuência (declarada pendente, só testnet) → titular atestado → Pix SIMULADO | lead, cessão, laudo, âncora do comprovante |
| 2 | Emitir | incorpora a cota; o issuer emite PLINARF à posição da Plina | emissão |
| 3 | Recuperar | 2ª cessão: a emissão entra na rede e o banco **falha** ao gravar a cota (falha injetada por trigger no banco descartável); a reexecução acha a tx pelo memo e **não emite de novo** | emissão recuperada |
| 4 | Investir | swap atômico TESOURO → PLINARF pelas rotas reais `swap/build` e `swap/submit` (investidor assina, issuer co-assina) | swap |
| 5 | Resgatar | investidor devolve metade do PLINARF ao distributor (BRL simulado no MVP testnet) | pagamento e auditoria ancorada |
| 6 | Realizar | comprador reserva a cota e a realização (Caminho A) entra no razão | lead, reserva, realização |
| 7 | Reconciliar | supply do PLINARF na rede = tokens das 2 cotas + subscrição; posição do investidor no banco = rede | — |

**Idempotência por perna:** cada perna é executada de novo e o smoke confere que nada duplica — pagamento (1 âncora, 1
`TransferenciaPix`), emissão (1 cota, supply igual), swap (mesma tx, `idempotent`), resgate (mesma tx, 1 auditoria) e
realização (1 realização, 1 movimento do razão).

## O que NÃO é real (dito sem rodeio)

- **TESOURO** é um ativo descartável da testnet no lugar do ativo-ponte da Etherfuse (que exige chave e o sandbox do anchor).
  O swap, a validação do envelope e a escrituração são o código real.
- **Pix** SIMULADO; o BRL do resgate é cálculo, não transferência.
- **Vercel Blob** é trocado por uma memória local só neste processo; o comprovante que vale é o do banco, com o hash ancorado.
- **Anuência** declarada pendente (só vale fora da mainnet) e **CPF sintético**: nada disso passa em produção.

## Se falhar

A saída termina em `FALHOU: <motivo>` e o contêiner é removido mesmo assim. Causas comuns: friendbot ou Horizon fora do ar
(repita), Docker parado (use `SMOKE_CICLO_PG_URL`), porta ou imagem `postgres:17-alpine` indisponível.
