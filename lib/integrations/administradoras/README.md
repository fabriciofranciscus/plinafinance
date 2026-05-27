# Administradoras — adapters B2B (M1.A)

Ver `docs/PRD-plina-v1.md` §M1 (F-M1-3).

Adapter por administradora (Embracon, Caixa, Bradesco, Porto Seguro, Itaú).
Interface mínima esperada:

```ts
export interface AdministradoraAdapter {
  nome: string;
  verificarContemplacao(numeroGrupo: string, numeroCota: string): Promise<{
    contemplada: boolean;
    dataContemplacao?: Date;
    valorBem?: string;
  }>;
  verificarAdimplencia(numeroGrupo: string, numeroCota: string): Promise<{
    adimplente: boolean;
    parcelasEmAberto: number;
  }>;
  verificarTitularidade(documento: string, numeroGrupo: string, numeroCota: string): Promise<{
    titular: boolean;
  }>;
  transferirTitularidade?(payload: TransferenciaPayload): Promise<TransferenciaResult>;
}
```

Fallback: cartório digital (`CaminhoCessao=CARTORIO_DIGITAL`) com taxa de
anuência embutida (100-300 bps) — gerenciada em `lib/services/originacao.ts`.

Bloqueado por: acordos B2B (trilha A do PRD).
