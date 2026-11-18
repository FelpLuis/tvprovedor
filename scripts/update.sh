#!/usr/bin/env bash
# Atualização controlada: backup -> git pull -> dependências -> migrações -> reinício -> verificação.
# Uso: sudo /opt/updown-digital/app/scripts/update.sh [branch]
set -euo pipefail

BASE="${UDS_BASE:-/opt/updown-digital}"
APP="$BASE/app"
VENV="$BASE/venv"
BRANCH="${1:-main}"
USER_NAME="updown-digital"

[ -r "$BASE/.env" ] || { echo "Arquivo $BASE/.env não encontrado"; exit 1; }
cd "$APP"
PREV="$(git rev-parse HEAD)"
echo "Versão atual: $PREV"

echo "1/6 Backup..."
"$APP/scripts/backup.sh"

echo "2/6 Atualizando código ($BRANCH)..."
sudo -u "$USER_NAME" git fetch origin "$BRANCH"
sudo -u "$USER_NAME" git merge --ff-only "origin/$BRANCH"
echo "Nova versão: $(git rev-parse HEAD)"

echo "3/6 Dependências..."
sudo -u "$USER_NAME" "$VENV/bin/pip" install --quiet -r backend/requirements.txt

echo "4/6 Migrações do banco..."
cd "$APP/backend"
sudo -u "$USER_NAME" bash -c "set -ae; . '$BASE/.env'; set +a; '$VENV/bin/alembic' upgrade head"

echo "5/6 Reiniciando o serviço..."
systemctl restart updown-digital
sleep 3

echo "6/6 Verificando..."
if curl -fsS http://127.0.0.1:8095/api/health; then
  echo; echo "Atualização concluída."
else
  echo "FALHA na verificação. Para voltar à versão anterior:"
  echo "  cd $APP && sudo -u $USER_NAME git checkout $PREV && systemctl restart updown-digital"
  echo "  (se houve migração, restaure o backup com scripts/restore.sh)"
  journalctl -u updown-digital -n 40 --no-pager
  exit 1
fi
