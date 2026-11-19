#!/usr/bin/env bash
# Instala e configura o app UpDown Digital em TVs Android pela rede (ADB), sem usar o navegador da TV.
#
# Uso:
#   scripts/instalar_tv.sh [opções] IP_DA_TV [IP_DA_TV2 ...]
#
# Opções:
#   --quiosque        o app vira a tela inicial da TV (abre sempre; recomendado para TVs dedicadas)
#   --apk ARQUIVO     usa um APK local em vez de baixar do servidor
#   --servidor URL    servidor do UpDown Digital (padrão: https://tv.updown.com.br)
#   --sem-ajustes     não altera protetor de tela/suspensão da TV
#
# Pré-requisitos na TV: opções do desenvolvedor ativas, "Depuração USB/ADB" e "Depuração pela
# rede" ligadas. No computador: adb (Ubuntu: apt install adb; Windows/macOS: platform-tools).
set -euo pipefail

PKG="br.com.updown.digital"
SERVER="https://tv.updown.com.br"
APK=""
KIOSK=0
TWEAKS=1
TARGETS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --quiosque) KIOSK=1 ;;
    --apk) APK="${2:?informe o arquivo}"; shift ;;
    --servidor) SERVER="${2:?informe a URL}"; shift ;;
    --sem-ajustes) TWEAKS=0 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    -*) echo "Opção desconhecida: $1"; exit 1 ;;
    *) TARGETS+=("$1") ;;
  esac
  shift
done

[ ${#TARGETS[@]} -gt 0 ] || { echo "Informe o IP de pelo menos uma TV. Ajuda: $0 --help"; exit 1; }
command -v adb >/dev/null || { echo "adb não encontrado (Ubuntu: sudo apt-get install --no-upgrade adb)"; exit 1; }

if [ -z "$APK" ]; then
  APK="$(mktemp --suffix=.apk)"
  trap 'rm -f "$APK"' EXIT
  echo "Baixando o app de $SERVER/app/updown-digital.apk ..."
  curl -fsSL -o "$APK" "$SERVER/app/updown-digital.apk"
fi
[ -s "$APK" ] || { echo "APK não encontrado: $APK"; exit 1; }

FAILED=0
for target in "${TARGETS[@]}"; do
  [[ "$target" == *:* ]] || target="$target:5555"
  echo
  echo "===== $target ====="
  adb connect "$target" >/dev/null || true
  if ! timeout 20 adb -s "$target" wait-for-device 2>/dev/null; then
    echo "Não foi possível conectar. Confirme na TV a autorização de depuração (aparece uma janela na primeira vez)."
    FAILED=1; continue
  fi
  run() { adb -s "$target" shell "$@"; }
  echo "Aparelho: $(run getprop ro.product.manufacturer | tr -d '\r') $(run getprop ro.product.model | tr -d '\r') · Android $(run getprop ro.build.version.release | tr -d '\r')"

  echo "Instalando o app..."
  if ! adb -s "$target" install -r "$APK"; then
    echo "Falha na instalação."; FAILED=1; continue
  fi

  # abre sozinho ao ligar a TV (Android 10+ exige esta liberação)
  run appops set "$PKG" SYSTEM_ALERT_WINDOW allow 2>/dev/null || true

  if [ "$TWEAKS" = 1 ]; then
    echo "Desativando protetor de tela e suspensão..."
    run settings put secure screensaver_enabled 0 2>/dev/null || true
    run settings put secure sleep_timeout 0 2>/dev/null || true
    run settings put system screen_off_timeout 2147483647 2>/dev/null || true
  fi

  if [ "$KIOSK" = 1 ]; then
    echo "Ativando modo quiosque (app como tela inicial)..."
    run pm enable "$PKG/.KioskHome" >/dev/null 2>&1 || true
    if ! run cmd package set-home-activity "$PKG/.KioskHome" >/dev/null 2>&1; then
      echo "Aviso: defina manualmente na TV: ao apertar HOME, escolha 'UpDown Digital' e 'Sempre'."
    fi
  fi

  if [ "$SERVER" != "https://tv.updown.com.br" ]; then
    # outro servidor (ex.: homologação): o app passa a abrir esta URL
    run am start -n "$PKG/.MainActivity" --es url "$SERVER/player/" >/dev/null
  else
    run am start -n "$PKG/.MainActivity" >/dev/null
  fi
  echo "Pronto. A TV deve exibir o código de ativação: ative em $SERVER → TVs → Ativar TV."
done

exit $FAILED
