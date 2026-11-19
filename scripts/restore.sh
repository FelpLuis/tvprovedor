#!/usr/bin/env bash
# Restaura um backup gerado por backup.sh.
# Uso: sudo ./restore.sh /var/backups/updown-digital/db-AAAAMMDD-HHMMSS.dump [/var/backups/updown-digital/storage-AAAAMMDD-HHMMSS.tar.gz]
# ATENÇÃO: substitui o conteúdo atual do banco updown_digital (e das mídias, se informado).
set -euo pipefail

BASE="${UDS_BASE:-/opt/updown-digital}"
ENV_FILE="$BASE/.env"
DB_DUMP="${1:?informe o arquivo db-*.dump}"
STORAGE_TAR="${2:-}"

[ -r "$ENV_FILE" ] || { echo "Arquivo $ENV_FILE não encontrado"; exit 1; }
DB_URL="$(grep -E '^UDS_DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
STORAGE="$(grep -E '^UDS_STORAGE_DIR=' "$ENV_FILE" | cut -d= -f2- || true)"
STORAGE="${STORAGE:-$BASE/storage}"
PG_URL="${DB_URL/postgresql+psycopg:/postgresql:}"

echo "Banco destino: ${PG_URL%%@*}@*** (somente o banco do UpDown Digital)"
read -r -p "Digite RESTAURAR para continuar: " ok
[ "$ok" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }

systemctl stop updown-digital
pg_restore --clean --if-exists --no-owner --dbname="$PG_URL" "$DB_DUMP"
if [ -n "$STORAGE_TAR" ]; then
  tar -C "$STORAGE" -xzf "$STORAGE_TAR"
  chown -R updown-digital:updown-digital "$STORAGE"
fi
systemctl start updown-digital
sleep 2
curl -fsS http://127.0.0.1:8095/api/health && echo " — restauração concluída"
