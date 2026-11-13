#!/bin/bash
# Genera CarteleraElBuenCorte-Instalador.zip: una copia limpia de la app +
# un Node.js portable para Windows + INSTALAR.bat (que copia todo a
# %LOCALAPPDATA%, instala dependencias, crea accesos directos y deja la
# cartelera arrancando sola con Windows).
#
# No depende de NSIS ni de ninguna herramienta de compilación de Windows —
# solo usa curl/unzip/rsync/zip, que ya vienen en macOS.
#
# Uso: ./build-installer.sh

set -e

NODE_VERSION="20.20.2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STAGE="$SCRIPT_DIR/stage"
DIST_NAME="CarteleraElBuenCorte-Instalador"

echo "==> Preparando copia limpia de la app..."
rm -rf "$STAGE/app"
mkdir -p "$STAGE/app"
rsync -a \
  --exclude='.git' --exclude='node_modules' --exclude='server/data' \
  --exclude='server/uploads/*' --exclude='tizen-app/.build' \
  --exclude='tizen-app/.manifest.tmp' --exclude='tizen-app/*signature*.xml' \
  --exclude='.DS_Store' --exclude='windows-installer' --exclude='.claude' \
  "$PROJECT_ROOT/" "$STAGE/app/"
mkdir -p "$STAGE/app/server/uploads"
touch "$STAGE/app/server/uploads/.gitkeep"

if [ ! -d "$STAGE/node-runtime" ]; then
  echo "==> Descargando Node.js $NODE_VERSION portable para Windows..."
  ZIP="$SCRIPT_DIR/.node-win-x64.zip"
  curl -fL -o "$ZIP" "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip"
  unzip -q "$ZIP" -d "$SCRIPT_DIR"
  mv "$SCRIPT_DIR/node-v${NODE_VERSION}-win-x64" "$STAGE/node-runtime"
  rm -f "$ZIP"
else
  echo "==> Node.js portable ya está en stage/node-runtime, lo reutilizo."
fi

echo "==> Armando el paquete final..."
rm -rf "$SCRIPT_DIR/dist"
mkdir -p "$SCRIPT_DIR/dist/$DIST_NAME"
cp -R "$STAGE/app" "$SCRIPT_DIR/dist/$DIST_NAME/app"
cp -R "$STAGE/node-runtime" "$SCRIPT_DIR/dist/$DIST_NAME/node-runtime"
cp "$SCRIPT_DIR/INSTALAR.bat" "$SCRIPT_DIR/dist/$DIST_NAME/"
cp "$SCRIPT_DIR/DESINSTALAR.bat" "$SCRIPT_DIR/dist/$DIST_NAME/"
cp "$SCRIPT_DIR/start-hidden.vbs" "$SCRIPT_DIR/dist/$DIST_NAME/"
cp "$SCRIPT_DIR/stop-server.vbs" "$SCRIPT_DIR/dist/$DIST_NAME/"
cp "$SCRIPT_DIR/reinstalar-dependencias.bat" "$SCRIPT_DIR/dist/$DIST_NAME/"
cp "$SCRIPT_DIR/LEEME.txt" "$SCRIPT_DIR/dist/$DIST_NAME/"

echo "==> Comprimiendo..."
cd "$SCRIPT_DIR/dist"
zip -rq "$DIST_NAME.zip" "$DIST_NAME"

echo "==> Listo: $SCRIPT_DIR/dist/$DIST_NAME.zip"
