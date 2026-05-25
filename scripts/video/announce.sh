# Helper de banner pro vídeo de integração.
# Source uma vez antes da gravação:
#
#   source scripts/video/announce.sh
#
# Uso:
#   plina_announce "POST /api/investidor/quote" \
#     "app/api/investidor/quote/route.ts → lib/anchors/etherfuse + Prisma" \
#     "Binding server-side: quote.toAmount persistido pra emissão"
#
# O banner aparece ANTES do próximo comando, fica visível pro espectador
# entender exatamente qual rota Plina + qual arquivo está sendo exercitado.

PLINA_BANNER_W=72
PLINA_C_TITLE='\033[1;36m'   # ciano negrito
PLINA_C_LABEL='\033[0;33m'   # amarelo
PLINA_C_FILE='\033[0;32m'    # verde
PLINA_C_DESC='\033[0;37m'    # cinza
PLINA_C_OFF='\033[0m'

plina_announce() {
  local route="${1:-}"
  local files="${2:-}"
  local desc="${3:-}"

  echo
  printf "${PLINA_C_TITLE}"
  printf "━%.0s" $(seq 1 $PLINA_BANNER_W)
  printf "${PLINA_C_OFF}\n"

  [ -n "$route" ] && printf "  ${PLINA_C_LABEL}📡 ROTA   ${PLINA_C_OFF} ${route}\n"
  [ -n "$files" ] && printf "  ${PLINA_C_LABEL}📂 CÓDIGO ${PLINA_C_OFF} ${PLINA_C_FILE}${files}${PLINA_C_OFF}\n"
  [ -n "$desc" ]  && printf "  ${PLINA_C_LABEL}💡 PROVA  ${PLINA_C_OFF} ${PLINA_C_DESC}${desc}${PLINA_C_OFF}\n"

  printf "${PLINA_C_TITLE}"
  printf "━%.0s" $(seq 1 $PLINA_BANNER_W)
  printf "${PLINA_C_OFF}\n\n"
}

# Atalho pra DB query — anuncia que está rodando psql contra o Postgres Plina.
plina_db() {
  local sql="${1:-}"
  plina_announce \
    "DB query · Postgres Plina" \
    "prisma/schema.prisma → EventoAudit / Quote / OnRampOrder" \
    "Persistência server-side com audit trail"
  psql "$DATABASE_URL" -c "$sql"
}
