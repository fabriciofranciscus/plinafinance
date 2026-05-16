/**
 * GET /.well-known/stellar.toml — SEP-0001
 *
 * Next.js 16 com Turbopack ignora arquivos estáticos em `public/.well-known/`
 * por causa do prefixo dot. Servimos via Route Handler que também controla
 * headers CORS exigidos pelo SEP-0001 ("anchors and asset issuers MUST serve
 * their toml file with CORS headers").
 *
 * Asset code on-chain `PLINARF` (sem hífen — restrição Stellar AlphaNum12).
 * Issuer + policy URL vêm do ParametrosPool no banco — fonte de verdade
 * única, não precisa duplicar em config.
 */

import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TOML_TEMPLATE = (issuer: string) => `# Plina Finance — Stellar TOML (SEP-0001)
#
# Asset: PLINARF (1 PLINA-RF = R$ 1,00 em direito creditório ajustado pelo NAV)
# Network: TESTNET (POC — mainnet exigirá multisig do issuer e smart account
# Soroban conforme ARCHITECTURE §3.2 + §3.3)
#
# Política de clawback pública e auditável em
# https://plina.finance/politica-clawback — quatro hipóteses exclusivas
# (whitepaper §6.5).

VERSION = "0.1.0"
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"

[DOCUMENTATION]
ORG_NAME = "Plina Finance"
ORG_DESCRIPTION = "Tokenizadora institucional de direito creditório brasileiro. Cotas de consórcio contempladas representadas como ativo Stellar PLINA-RF lastreado em FIDC sob CVM 175."
ORG_URL = "https://plina.finance"
ORG_OFFICIAL_EMAIL = "contato@plina.finance"

[[CURRENCIES]]
code = "PLINARF"
issuer = "${issuer}"
display_decimals = 2
name = "Plina Direito Creditório (POC)"
desc = "Token Stellar representando cota de direito creditório brasileiro (cota de consórcio contemplada). 1 PLINA-RF = R$ 1,00 em NAV. POC em testnet — não negociável. Política de clawback pública em https://plina.finance/politica-clawback."
conditions = "POC institucional na testnet. Mainnet exige enquadramento FIDC formal sob CVM 175 conforme Fase 1 do roadmap."
status = "test"
is_asset_anchored = true
anchor_asset_type = "other"
attestation_of_reserve = "https://plina.finance/politica-clawback"
regulated = true
approval_criteria = "AUTH_REQUIRED — investidor passa pelo onboarding KYC institucional da Plina antes de receber trustline autorizada."

[PRINCIPALS]
# Founders detalhados em https://plina.finance#equipe
`;

export async function GET() {
  const params = await db.parametrosPool.findUnique({
    where: { id: 'singleton' },
  });

  // Fallback pra env caso seed ainda não tenha rodado.
  const issuer =
    params?.issuerPubkey ?? process.env.STELLAR_ISSUER_PUBLIC ?? '';

  return new Response(TOML_TEMPLATE(issuer), {
    status: 200,
    headers: {
      // SEP-0001 exige CORS aberto pro anchor toml.
      'Access-Control-Allow-Origin': '*',
      // Sem MIME type oficial pra toml; text/plain é o padrão consensual.
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
