/**
 * GET /.well-known/stellar.toml — SEP-0001
 *
 * Next.js 16 com Turbopack ignora arquivos estáticos em `public/.well-known/`
 * por causa do prefixo dot. Servimos via Route Handler que também controla
 * headers CORS exigidos pelo SEP-0001 ("anchors and asset issuers MUST serve
 * their toml file with CORS headers").
 *
 * Asset code on-chain `PLINARF` (sem hífen — restrição Stellar AlphaNum12).
 * Issuer: SÓ do env do deploy (STELLAR_ISSUER_PUBLIC), a mesma fonte das rotas
 * que movem dinheiro. É o que liga o domínio ao ativo para carteiras: não lê o
 * banco (editável) e falha fechado (500, sem toml) se faltar ou for inválido.
 */

import { StrKey } from '@stellar/stellar-sdk';

export const dynamic = 'force-dynamic';

const TOML_TEMPLATE = (issuer: string) => `# Plina Finance — Stellar TOML (SEP-0001)
#
# Asset: PLINARF — token de demonstração, sem valor financeiro real
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
ORG_DESCRIPTION = "Cotas contempladas de consórcio, com registro verificável na Stellar testnet. Projeto em desenvolvimento; sem oferta."
ORG_URL = "https://plina.finance"
ORG_OFFICIAL_EMAIL = "contato@plina.finance"
ORG_LOGO = "https://plina.finance/icon.svg"

# SEPs planejados (fase futura):
#   TRANSFER_SERVER      = ""   # SEP-6  server-to-server com anchors parceiras
#   KYC_SERVER           = ""   # SEP-12 KYC compartilhado
#   WEB_AUTH_ENDPOINT    = ""   # SEP-10 auth do investidor
#   ANCHOR_QUOTE_SERVER  = ""   # SEP-38 BRL ↔ USDC/EURC
#   DIRECT_PAYMENT_SERVER = ""  # SEP-31 cross-border B2B
# POC integra Etherfuse (REST proprietário) — SEPs entram quando anchors
# parceiras de USDC/EURC entrarem, em fase futura.

[[CURRENCIES]]
code = "PLINARF"
issuer = "${issuer}"
display_decimals = 2
name = "Plina · token de demonstração (testnet)"
desc = "Token de demonstração em rede de testes, sem valor financeiro real e não negociável. Política de clawback pública em https://plina.finance/politica-clawback. AUTH_REQUIRED — a conta passa pelo cadastro e KYC da Plina antes de receber trustline autorizada."
conditions = "Demonstração em testnet. Qualquer operação com valor real depende de aprovação regulatória e de documentação própria; não há oferta em andamento."
status = "test"
# SEP-1: exatamente um entre is_unlimited, fixed_number e max_number. O issuer
# emite conforme as cotas entram, sem teto fixo.
is_unlimited = true
# SEP-1: is_asset_anchored só é true se o token é resgatável pelo ativo
# subjacente; em testnet não é (sem anchor_asset_type nem attestation_of_reserve).
is_asset_anchored = false
# SEP-8: regulated = true exige approval_server (co-assinatura de cada tx), que
# não existe. AUTH_REQUIRED/REVOCABLE/CLAWBACK seguem ligados no issuer on-chain.
regulated = false

# Seção de principais omitida de propósito (opcional na SEP-1): sem nomes nem e-mails
# pessoais no arquivo público. Contato: ORG_OFFICIAL_EMAIL.
`;

export async function GET() {
  const issuer = process.env.STELLAR_ISSUER_PUBLIC ?? '';
  if (!StrKey.isValidEd25519PublicKey(issuer)) {
    return new Response('stellar.toml indisponível: issuer não configurado.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  return new Response(TOML_TEMPLATE(issuer), {
    status: 200,
    headers: {
      // SEP-0001 exige CORS aberto pro anchor toml.
      'Access-Control-Allow-Origin': '*',
      // Sem MIME type oficial pra toml; text/plain é o padrão consensual.
      'Content-Type': 'text/plain; charset=utf-8',
      // Navegador e CDN por até 5 min. Explorers têm cache próprio (fora do nosso controle).
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
