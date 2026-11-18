#!/usr/bin/env bash
# Backup do banco (pg_dump formato custom) e das mídias.
# Uso: sudo /opt/updown-digital/app/scripts/backup.sh
# Agendamento sugerido (cron do root): 30 2 * * * /opt/updown-digital/app/scripts/backup.sh >> /var/log/updown-digital-backup.log 2>&1
set -euo pipefail
umask 077

BASE="${UDS_BASE:-/opt/updown-digital}"
DEST="${UDS_BACKUP_DIR:-/var/backups/updown-digital}"
KEEP_DAYS="${UDS_BACKUP_KEEP_DAYS:-14}"
ENV_FILE="$BASE/.env"
STAMP="$(date +%Y%m%d-%H%M%S)"

[ -r "$ENV_FILE" ] || { echo "Arquivo $ENV_FILE não encontrado"; exit 1; }
DB_URL="$(grep -E '^UDS_DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
STORAGE="$(grep -E '^UDS_STORAGE_DIR=' "$ENV_FILE" | cut -d= -f2- || true)"
STORAGE="${STORAGE:-$BASE/storage}"
# pg_dump entende URLs postgresql:// (remove o "+psycopg" do SQLAlchemy)
PG_URL="${DB_URL/postgresql+psycopg:/postgresql:}"

install -d -m 0700 "$DEST"
echo "[$(date)] backup do banco..."
pg_dump --format=custom --no-owner --file="$DEST/db-$STAMP.dump" "$PG_URL"
echo "[$(date)] backup das mídias ($STORAGE)..."
tar -C "$STORAGE" -czf "$DEST/storage-$STAMP.tar.gz" media thumbnails
cp "$ENV_FILE" "$DEST/env-$STAMP" && chmod 600 "$DEST/env-$STAMP"

echo "[$(date)] removendo backups com mais de $KEEP_DAYS dias em $DEST"
find "$DEST" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'storage-*.tar.gz' -o -name 'env-*' \) -mtime +"$KEEP_DAYS" -print -delete
ls -lh "$DEST" | tail -n 6
echo "[$(date)] concluído: $DEST/*-$STAMP.*"
