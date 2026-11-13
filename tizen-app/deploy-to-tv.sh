#!/bin/bash
# Empaqueta e instala la cartelera como app nativa en la Samsung TV (Tizen),
# conectado a la MISMA red wifi que la TV.
#
# Uso:
#   ./deploy-to-tv.sh <IP-de-la-TV> <IP-del-servidor>
#
# Ejemplo:
#   ./deploy-to-tv.sh 192.168.1.42 192.168.1.50
#
# Requisitos (ver tizen-app/README.md):
#   - Tizen Studio CLI instalado y en el PATH (sdb y tizen)
#   - Modo Desarrollador activado en la TV, con la IP de este PC ya cargada
#   - Perfil de firma "ebcorte" ya creado (una sola vez, ver README)

set -e

TV_IP="$1"
SERVER_IP="$2"
IP_RE='^[0-9]{1,3}(\.[0-9]{1,3}){3}$'

if [ -z "$TV_IP" ] || [ -z "$SERVER_IP" ]; then
  echo "Uso: ./deploy-to-tv.sh <IP-de-la-TV> <IP-del-servidor>"
  exit 1
fi

if ! [[ "$TV_IP" =~ $IP_RE ]]; then
  echo "IP de la TV inválida: $TV_IP"
  exit 1
fi
if ! [[ "$SERVER_IP" =~ $IP_RE ]]; then
  echo "IP del servidor inválida: $SERVER_IP"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/.build"
SRC_DIR="$BUILD_DIR/src"

rm -rf "$BUILD_DIR"
mkdir -p "$SRC_DIR"
cp "$SCRIPT_DIR/config.xml" "$SCRIPT_DIR/icon.png" "$SRC_DIR/"

echo "==> Apuntando la app a http://$SERVER_IP:4010/player/1"
# Se genera en una copia aparte (.build/src) — el index.html original del
# repo nunca se modifica, así cada instalación parte siempre del mismo
# origen y no queda un cambio sin commitear después de cada despliegue.
sed -E "s#var PLAYER_URL = '[^']*'#var PLAYER_URL = 'http://$SERVER_IP:4010/player/1'#" \
  "$SCRIPT_DIR/index.html" > "$SRC_DIR/index.html"

echo "==> Conectando a la TV ($TV_IP)..."
sdb connect "$TV_IP" || true
sdb connect "$TV_IP:26101" || true

DEVICE_ID=$(sdb devices | grep -v "List of devices" | awk 'NF{print $1}' | head -n1)
if [ -z "$DEVICE_ID" ]; then
  echo "No se encontró la TV conectada. Revisa que Modo Desarrollador esté activo y la IP sea correcta."
  exit 1
fi
echo "==> TV detectada: $DEVICE_ID"

echo "==> Empaquetando la app (.wgt)..."
tizen package -t wgt -s ebcorte -o "$BUILD_DIR" -- "$SRC_DIR"

WGT_FILE=$(find "$BUILD_DIR" -maxdepth 1 -name "*.wgt" | head -n1)
echo "==> Instalando $WGT_FILE en la TV..."
tizen install -n "$WGT_FILE" -t "$DEVICE_ID"

echo "==> Listo. Busca 'Cartelera El Buen Corte' en el menú Apps de la TV y ábrela"
echo "    (o ejecútala ahora con: tizen run -p ebcorteTV1.CarteleraEBC -t $DEVICE_ID)"
