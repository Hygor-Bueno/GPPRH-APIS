#!/usr/bin/env bash
#
# Valida os containers do backend contra o monolito em produção.
#
# A ideia central: para cada rota, chamar o PM2 atual (porta 4000) e o container
# (porta 4002) com a MESMA sessão e comparar. "Não deu erro" não prova nada —
# resposta idêntica ao que já está em produção, prova.
#
# Rode com o PM2 e os containers no ar ao mesmo tempo. Nada aqui escreve dados:
# só rotas GET e um login.
#
# Uso:
#   ./scripts/validar-containers.sh
#   BRANCH=0101 REFERENCE=202607 ./scripts/validar-containers.sh
#
# Variáveis:
#   PROD_URL    default http://127.0.0.1:4000   (monolito no PM2 — gabarito)
#   NEW_URL     default http://127.0.0.1:4002   (container api-gipp-enterprises)
#   PUBLIC_URL  default http://127.0.0.1:4010   (container api-gpprh)
#   WS_PORT     default 4011                   (container ws-gipp-enterprises)
#   BRANCH      código da filial para o PDF de recibo
#   REFERENCE   competência YYYYMM para o PDF de recibo

set -uo pipefail

PROD_URL="${PROD_URL:-http://127.0.0.1:4000}"
NEW_URL="${NEW_URL:-http://127.0.0.1:4002}"
PUBLIC_URL="${PUBLIC_URL:-http://127.0.0.1:4010}"
WS_PORT="${WS_PORT:-4011}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFALHA\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33mAVISO\033[0m %s\n' "$1"; }
head_() { printf '\n\033[1m== %s\033[0m\n' "$1"; }


# =============================================================================
head_ "1. Containers no ar"
# =============================================================================
docker compose ps --format '  {{.Name}}\t{{.State}}\t{{.Ports}}' 2>/dev/null || {
  bad "docker compose ps falhou — os containers estão de pé?"; exit 1;
}


# =============================================================================
head_ "2. Startup do api-gipp-enterprises (SQL Server e Oracle)"
# =============================================================================
LOGS="$(docker compose logs --tail 200 api-gipp-enterprises 2>&1)"

if grep -q "Conectado ao Protheus MSSQL" <<<"$LOGS"; then
  ok "SQL Server conectou no startup"
else
  bad "não encontrei 'Conectado ao Protheus MSSQL' no log — veja: docker compose logs api-gipp-enterprises"
fi

if grep -qiE "DPI-1047|libclntsh|Cannot locate|libaio" <<<"$LOGS"; then
  bad "Oracle Instant Client não carregou (erro de biblioteca no log)"
  grep -iE "DPI-1047|libclntsh|Cannot locate|libaio" <<<"$LOGS" | head -3 | sed 's/^/         /'
else
  ok "sem erro de carregamento do Oracle Client no log"
fi


# =============================================================================
head_ "3. Login"
# =============================================================================
read -rp "  usuário: " LOGIN_USER
read -rsp "  senha:   " LOGIN_PASS; echo

do_login() { # $1=base  $2=cookiejar
  curl -sS -o "$TMP/login.out" -w '%{http_code}' \
    -c "$2" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$LOGIN_USER\",\"password\":\"$LOGIN_PASS\"}" \
    "$1/global/login" 2>/dev/null
}

CODE_PROD="$(do_login "$PROD_URL" "$TMP/cookie.prod")"
CODE_NEW="$(do_login "$NEW_URL"  "$TMP/cookie.new")"

[ "$CODE_PROD" = "200" ] && ok "login no monolito (4000): $CODE_PROD" \
                         || bad "login no monolito (4000): $CODE_PROD — credencial errada?"
[ "$CODE_NEW" = "200" ]  && ok "login no container (4002): $CODE_NEW" \
                         || { bad "login no container (4002): $CODE_NEW"; sed 's/^/         /' "$TMP/login.out"; }

if grep -q accessToken "$TMP/cookie.new" 2>/dev/null; then
  ok "cookie accessToken emitido pelo container"
else
  bad "container não emitiu cookie accessToken"
fi

# Segredos JWT separados: o cookie do container público NÃO deve ser aceito
# pelo interno. Só faz sentido testar depois de preencher os JWT_* no compose.
if [ "$CODE_NEW" = "200" ]; then
  CROSS="$(curl -sS -o /dev/null -w '%{http_code}' -b "$TMP/cookie.prod" "$NEW_URL/global/me" 2>/dev/null)"
  if [ "$CROSS" = "200" ]; then
    warn "token do monolito é aceito pelo container — esperado se os JWT_* ainda estão vazios no compose"
  else
    ok "token do monolito rejeitado pelo container ($CROSS) — segredos já estão separados"
  fi
fi


# =============================================================================
head_ "4. Paridade de rotas (monolito vs container)"
# =============================================================================
# Compara status HTTP e hash do corpo. Divergência de hash não é
# necessariamente bug (campos com timestamp variam), mas divergência de STATUS é.
compare() { # $1=rota legível  $2=path
  local sp bp sn bn
  sp="$(curl -sS -o "$TMP/p.json" -w '%{http_code}' -b "$TMP/cookie.prod" "$PROD_URL$2" 2>/dev/null)"
  sn="$(curl -sS -o "$TMP/n.json" -w '%{http_code}' -b "$TMP/cookie.new"  "$NEW_URL$2"  2>/dev/null)"
  bp="$(md5sum < "$TMP/p.json" | cut -c1-8)"
  bn="$(md5sum < "$TMP/n.json" | cut -c1-8)"

  if [ "$sp" != "$sn" ]; then
    bad "$1 — status divergente: 4000=$sp  4002=$sn"
    head -c 300 "$TMP/n.json" | sed 's/^/         /'; echo
  elif [ "$bp" = "$bn" ]; then
    ok "$1 — status $sn, corpo idêntico"
  else
    ok "$1 — status $sn (corpo difere: $bp vs $bn — confira se é campo variável)"
  fi
}

compare "/global/me"              "/global/me"
compare "/global/epp/products"    "/global/epp/products"
compare "/global/epp/orders"      "/global/epp/orders"
compare "/global/gipp-rh/receipt" "/global/gipp-rh/receipt?reference=${REFERENCE:-$(date +%Y%m)}"

# ORACLE de verdade. /epp/products/consinco exigiria codigo_acesso + lojas
# (dados específicos); esta rota só precisa de ?source=consinco e vai ao
# Consinco do mesmo jeito. Status 200 aqui é a prova de que o thick mode
# carregou e conectou — o log de startup não prova nada, porque o
# initOracleClient() só roda na primeira query (config/oracle.js:_initClient).
compare "/global/shops/audit (ORACLE)" "/global/shops/audit?source=consinco"
compare "/global/shops/audit (mssql)"  "/global/shops/audit?source=protheus"


# =============================================================================
head_ "5. PDF de recibo (Puppeteer + fontes)"
# =============================================================================
REF="${REFERENCE:-$(date +%Y%m)}"

# A rota exige `employee_code` OU `payee_id` além do reference — sem isso ela
# responde 400 e o Puppeteer nunca roda. Em vez de você adivinhar um código,
# descobrimos um a partir da própria listagem de recibos da competência.
if [ -z "${EMPLOYEE:-}" ]; then
  curl -sS -o "$TMP/lista.json" -b "$TMP/cookie.new" \
    "$NEW_URL/global/gipp-rh/receipt?reference=$REF" 2>/dev/null
  EMPLOYEE="$(grep -oE '"employee_code"[[:space:]]*:[[:space:]]*"?[0-9A-Za-z]+' "$TMP/lista.json" \
              | head -1 | grep -oE '[0-9A-Za-z]+$')"
  [ -n "$EMPLOYEE" ] && warn "employee_code descoberto na listagem: $EMPLOYEE"
fi

if [ -z "${BRANCH:-}" ]; then
  warn "BRANCH não informado — pulando. Rode: BRANCH=<filial> REFERENCE=YYYYMM $0"
elif [ -z "$EMPLOYEE" ]; then
  warn "nenhum employee_code encontrado em $REF — informe manualmente:"
  warn "  EMPLOYEE=<codigo> BRANCH=$BRANCH REFERENCE=$REF $0"
else
  for pair in "prod:$PROD_URL:4000" "new:$NEW_URL:4002"; do
    tag="${pair%%:*}"; rest="${pair#*:}"; base="${rest%:*}"; port="${rest##*:}"
    st="$(curl -sS --max-time 120 -o "$TMP/recibo.$tag.pdf" -w '%{http_code}' \
           -b "$TMP/cookie.$tag" \
           "$base/global/gipp-rh/receipt/$BRANCH?reference=$REF&employee_code=$EMPLOYEE" 2>/dev/null)"
    sz="$(stat -c%s "$TMP/recibo.$tag.pdf" 2>/dev/null || echo 0)"
    if [ "$st" = "200" ] && head -c4 "$TMP/recibo.$tag.pdf" | grep -q '%PDF'; then
      ok "PDF gerado na $port — ${sz} bytes"
      cp "$TMP/recibo.$tag.pdf" "./recibo-$tag.pdf"
    else
      bad "PDF na $port — status $st, ${sz} bytes"
      head -c 300 "$TMP/recibo.$tag.pdf" | sed 's/^/         /'; echo
    fi
  done
  warn "abra recibo-prod.pdf e recibo-new.pdf lado a lado: acento virando caixa = falta pacote de fonte na imagem"
fi


# =============================================================================
head_ "6. Backend público (container, 4010)"
# =============================================================================
ST="$(curl -sS -o "$TMP/job.json" -w '%{http_code}' "$PUBLIC_URL/gpprh/job" 2>/dev/null)"
[ "$ST" = "200" ] && ok "/gpprh/job (rota pública) — $ST" || bad "/gpprh/job — $ST"

# O público NÃO deve responder as rotas internas: é o ponto da separação.
for r in /global/me /gipp /protheus; do
  ST="$(curl -sS -o /dev/null -w '%{http_code}' "$PUBLIC_URL$r" 2>/dev/null)"
  [ "$ST" = "404" ] && ok "$r isolado do público — 404" \
                    || bad "$r respondeu $ST no backend público (deveria ser 404)"
done


# =============================================================================
head_ "7. WebSocket (container, $WS_PORT)"
# =============================================================================
# --max-time é obrigatório aqui: num upgrade bem-sucedido o curl fica pendurado
# esperando frames do WebSocket e o script nunca termina.
ST="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' \
      -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
      -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
      "http://127.0.0.1:$WS_PORT/" 2>/dev/null)"
case "$ST" in
  101|400|401) ok "porta $WS_PORT respondeu ao upgrade ($ST) — servidor de pé" ;;
  000)         bad "porta $WS_PORT não respondeu — container ws-gipp-enterprises subiu?" ;;
  *)           warn "porta $WS_PORT retornou $ST — verifique o log do ws-gipp-enterprises" ;;
esac


# =============================================================================
printf '\n\033[1m== Resultado: %d passaram, %d falharam\033[0m\n' "$PASS" "$FAIL"
# =============================================================================
[ "$FAIL" -eq 0 ] || exit 1
