#!/usr/bin/env bash
# Diagnóstico SOMENTE LEITURA do servidor antes da instalação/atualização.
# Não instala, não reinicia e não altera nada.
export PAGER=cat SYSTEMD_PAGER=cat
PORT="${UDS_PORT:-8095}"
DOMAIN="${UDS_DOMAIN:-tv.updown.com.br}"

section() { printf '\n===== %s =====\n' "$1"; }

section "SISTEMA"
grep PRETTY_NAME /etc/os-release
echo "CPUs: $(nproc)"; free -h | sed -n '1,3p'
df -h / /opt 2>/dev/null | sort -u

section "PYTHON"
python3 --version
python3 -c 'import venv, ensurepip' 2>/dev/null && echo "venv/ensurepip: OK" || echo "venv/ensurepip: AUSENTE (pacote python3-venv)"
command -v ffmpeg >/dev/null && echo "ffmpeg: $(ffmpeg -version | head -1)" || echo "ffmpeg: não instalado (opcional: miniaturas/duração de vídeos)"

section "PORTA $PORT"
if ss -lnt "( sport = :$PORT )" | grep -q LISTEN; then
  echo "OCUPADA:"; ss -lntp "( sport = :$PORT )"
else
  echo "livre"
fi

section "CADDY"
systemctl is-active caddy
caddy version 2>/dev/null
grep -n "$DOMAIN" /etc/caddy/Caddyfile /etc/caddy/*.caddy /etc/caddy/conf.d/* 2>/dev/null || echo "nenhuma referência a $DOMAIN"
grep -n "^import" /etc/caddy/Caddyfile 2>/dev/null

section "POSTGRESQL"
pg_lsclusters 2>/dev/null
for port in $(pg_lsclusters -h 2>/dev/null | awk '{print $3}'); do
  echo "-- cluster porta $port:"
  sudo -u postgres psql -p "$port" -At -c "select version();" 2>/dev/null
  sudo -u postgres psql -p "$port" -At -c "select datname from pg_database where not datistemplate order by 1;" 2>/dev/null | sed 's/^/   db: /'
done

section "DNS"
getent ahostsv4 "$DOMAIN" | head -1 || echo "não resolve"

section "UPDOWN DIGITAL SIGNAGE"
systemctl is-active updown-digital 2>/dev/null || true
curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null && echo || echo "aplicação não está respondendo em 127.0.0.1:$PORT"
