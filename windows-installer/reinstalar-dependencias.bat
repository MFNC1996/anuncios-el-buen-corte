@echo off
REM Si la instalacion automatica de dependencias fallo (por ejemplo, por no
REM tener internet en ese momento), corre este archivo para reintentarla.
cd /d "%~dp0"
echo Instalando dependencias (necesita internet)...
"node-runtime\npm.cmd" install --omit=dev --no-fund --no-audit
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Hubo un problema instalando las dependencias. Revisa tu conexion a internet.
  pause
  exit /b 1
)
echo.
echo Listo. Ya puedes usar el acceso directo "Iniciar Cartelera".
pause
