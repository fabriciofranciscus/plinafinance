# PSP — Pix real (M1)

Ver `docs/PRD-plina-v1.md` §M1 (F-M1-2).

Cliente Pix de um PSP regulado (candidatos: Stark Infra, BTG OpenFinance,
Inter, Itaú Connect). Em testnet/staging cair pro modo `PIX_SIMULADO` atual
(`Pagamento.metodo=PIX_SIMULADO`).

Interface mínima:

```ts
export interface PixProvider {
  criarCobranca(payload: {
    valor: string;
    descricao: string;
    idempotencyKey: string;
    chavePix?: string;
    dadosFavorecido: { documento: string; nome: string };
  }): Promise<{ txid: string; brcode: string; expiraEm: Date }>;

  consultarStatus(txid: string): Promise<'PENDENTE' | 'PAGO' | 'EXPIRADO' | 'CANCELADO'>;

  webhookHandler(req: Request): Promise<{ txid: string; status: string }>;  // HMAC validate
}
```

Idempotência: usar `Pagamento.idempotencyKey @unique` (já no schema).

Bloqueado por: conta PJ + contrato com PSP (trilha A do PRD).
