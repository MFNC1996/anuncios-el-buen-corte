#!/bin/bash
# Genera dos formas del instalador de Windows a partir del mismo contenido:
#   - CarteleraElBuenCorte-Instalador.zip   (descomprimir y correr INSTALAR.bat)
#   - CarteleraElBuenCorte-Setup.exe        (un solo .exe autoextraíble que
#                                             se descomprime e instala solo)
#
# El .exe se arma concatenando el módulo SFX oficial de 7-Zip para Windows
# (un binario PE real, descargado del propio proyecto 7-Zip) + un bloque de
# configuración + el archivo .7z con todo el contenido. No requiere NSIS ni
# ninguna herramienta de compilación de Windows.
#
# Requisitos en esta máquina (la que genera el instalador, no la que lo usa):
#   - 7z (p7zip): brew install p7zip
#   - rsync, curl, unzip, zip (ya vienen en macOS)
#
# Uso: ./build-installer.sh

set -e

NODE_VERSION="20.20.2"
LZMA_SDK_VERSION="2606"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STAGE="$SCRIPT_DIR/stage"
DIST_NAME="CarteleraElBuenCorte-Instalador"

command -v 7z >/dev/null || { echo "Falta 7z. Instálalo con: brew install p7zip"; exit 1; }

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

if [ ! -f "$STAGE/7zSD.sfx" ]; then
  echo "==> Descargando el módulo SFX oficial de 7-Zip para Windows..."
  SDK_ZIP="$SCRIPT_DIR/.lzma-sdk.7z"
  curl -fL -o "$SDK_ZIP" "https://github.com/ip7z/7zip/releases/download/${LZMA_SDK_VERSION:0:2}.${LZMA_SDK_VERSION:2}/lzma${LZMA_SDK_VERSION}.7z"
  7z e -y -o"$SCRIPT_DIR/.lzma-sdk-tmp" "$SDK_ZIP" bin/7zSD.sfx >/dev/null
  mv "$SCRIPT_DIR/.lzma-sdk-tmp/7zSD.sfx" "$STAGE/7zSD.sfx"
  rm -rf "$SCRIPT_DIR/.lzma-sdk-tmp" "$SDK_ZIP"
else
  echo "==> Módulo SFX ya está en stage/7zSD.sfx, lo reutilizo."
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

echo "==> Comprimiendo (.zip)..."
cd "$SCRIPT_DIR/dist"
zip -rq "$DIST_NAME.zip" "$DIST_NAME"

echo "==> Armando el instalador de un solo clic (.exe)..."
# Directory="" es clave: el módulo arma el comando a ejecutar como
# Directory + RunProgram pegados sin espacio. Por defecto Directory vale
# ".\", así que sin esta línea "cmd /c INSTALAR.bat" queda convertido en
# ".\cmd /c INSTALAR.bat" — Windows busca un archivo llamado "cmd" (sin
# .exe) dentro de la carpeta extraída, no lo encuentra, y tira exactamente
# "el sistema no puede encontrar el archivo especificado". Con Directory=""
# no se pega nada y "cmd" se resuelve por el PATH del sistema como corresponde.
cat > "$SCRIPT_DIR/dist/.sfx-config.txt" <<'EOF'
;!@Install@!UTF-8!
Title="Cartelera El Buen Corte"
BeginPrompt="Instalar Cartelera El Buen Corte?"
Directory=""
RunProgram="cmd /c INSTALAR.bat"
;!@InstallEnd@!
EOF
7z a -mx=5 -t7z "$SCRIPT_DIR/dist/.payload.7z" "./$DIST_NAME/"* >/dev/null
cat "$STAGE/7zSD.sfx" "$SCRIPT_DIR/dist/.sfx-config.txt" "$SCRIPT_DIR/dist/.payload.7z" > "$SCRIPT_DIR/dist/CarteleraElBuenCorte-Setup.exe"
rm -f "$SCRIPT_DIR/dist/.sfx-config.txt" "$SCRIPT_DIR/dist/.payload.7z"

echo "==> Listo:"
echo "    $SCRIPT_DIR/dist/$DIST_NAME.zip"
echo "    $SCRIPT_DIR/dist/CarteleraElBuenCorte-Setup.exe"
