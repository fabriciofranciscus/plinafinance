/**
 * Flags client-side do fluxo do investidor. O `getFlag` de `lib/env/flags.ts` é
 * assíncrono/servidor (Edge Config), então pra gatear UI no client lemos as
 * variantes públicas `NEXT_PUBLIC_*` (inline pelo Next no bundle).
 *
 * Default `false` → os scaffolds institucionais (trilha internacional, custódia
 * não-SELF, multimoeda) ficam inertes até a integração. Espelham as flags
 * server `INTL_INVESTOR_FLOW` / `CUSTODY_PROVIDERS`.
 */

export const INTL_FLOW_ENABLED =
  process.env.NEXT_PUBLIC_INTL_INVESTOR_FLOW === 'true';

export const CUSTODY_PROVIDERS_ENABLED =
  process.env.NEXT_PUBLIC_CUSTODY_PROVIDERS === 'true';
