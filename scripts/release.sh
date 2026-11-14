#!/bin/bash
# Publica una actualización: empaqueta el código (sin node_modules/datos/fotos)
# en update.zip y crea un Release en GitHub con la versión de package.json.
# El botón "Buscar actualización" del panel admin de cada local la detecta sola.
#
# Uso: ./scripts/release.sh ["notas de la version"]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="$(node -p "require('$PROJECT_ROOT/package.json').version")"
TAG="v$VERSION"
NOTES="${1:-Actualización $VERSION}"
STAGE="$SCRIPT_DIR/.release-stage"

if git -C "$PROJECT_ROOT" rev-parse "$TAG" >/dev/null 2>&1; then
  echo "El tag $TAG ya existe. Sube la version en package.json antes de publicar otra release."
  exit 1
fi

echo "==> Empaquetando $TAG..."
rm -rf "$STAGE"
mkdir -p "$STAGE"
rsync -a \
  --exclude='.git' --exclude='node_modules' --exclude='server/data' \
  --exclude='server/uploads/*' --exclude='tizen-app/.build' \
  --exclude='tizen-app/.manifest.tmp' --exclude='tizen-app/*signature*.xml' \
  --exclude='.DS_Store' --exclude='windows-installer' --exclude='.claude' \
  --exclude='.github' --exclude='scripts/.release-stage' \
  "$PROJECT_ROOT/" "$STAGE/"
mkdir -p "$STAGE/server/uploads"
touch "$STAGE/server/uploads/.gitkeep"

rm -f "$SCRIPT_DIR/update.zip"
(cd "$STAGE" && zip -rq "$SCRIPT_DIR/update.zip" .)
rm -rf "$STAGE"

echo "==> Creando release $TAG en GitHub..."
gh release create "$TAG" "$SCRIPT_DIR/update.zip" --title "$TAG" --notes "$NOTES"

rm -f "$SCRIPT_DIR/update.zip"
echo "==> Listo. Los paneles admin ya pueden encontrar esta actualización."
