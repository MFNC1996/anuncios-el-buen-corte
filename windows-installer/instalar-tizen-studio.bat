@echo off
REM Instala el SDK de Tizen (necesario SOLO si la TV termina siendo una
REM Samsung) en este mismo PC. NORMALMENTE no hace falta correr esto a mano:
REM el panel admin (pestaña TV -> TV Samsung) tiene un boton "Instalar
REM herramientas de Tizen" que hace lo mismo con un clic. Este .bat queda
REM como respaldo manual por si ese boton no funciona por algun motivo.
REM
REM Requiere internet. Puede tardar varios minutos.

setlocal
set "TIZEN_VERSION=6.0"
set "INSTALLER=web-cli_Tizen_Studio_%TIZEN_VERSION%_windows-64.exe"
set "URL=https://download.tizen.org/sdk/Installer/tizen-studio_%TIZEN_VERSION%/%INSTALLER%"
set "BUNDLED=%~dp0tizen-studio-installer.exe"
set "DEST=%TEMP%\%INSTALLER%"
set "TIZEN_HOME=%USERPROFILE%\tizen-studio"
set "TIZEN_BIN=%TIZEN_HOME%\tools\ide\bin"

if exist "%BUNDLED%" (
  echo [1/3] Usando el instalador que ya viene junto al programa...
  set "DEST=%BUNDLED%"
) else (
  echo [1/3] Descargando el SDK de Tizen (necesita internet, puede tardar)...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri '%URL%' -OutFile '%DEST%'"
  if not exist "%DEST%" (
    echo No se pudo descargar el instalador. Revisa tu conexion a internet.
    pause
    exit /b 1
  )
)

echo [2/3] Instalando en %TIZEN_HOME% (puede tardar varios minutos)...
"%DEST%" --accept-license --no-java-check "%TIZEN_HOME%"
if not exist "%TIZEN_BIN%\tizen.bat" (
  echo.
  echo Algo fallo en la instalacion: no aparecio %TIZEN_BIN%\tizen.bat
  echo Revisa el instalador manualmente: %DEST%
  pause
  exit /b 1
)

echo [3/3] Creando el certificado de firma de la app...
call "%TIZEN_BIN%\tizen.bat" certificate -a "El Buen Corte" -p 0000 -f ebcorte -c "CL"
call "%TIZEN_BIN%\tizen.bat" security-profiles add -n ebcorte -a "%TIZEN_HOME%-data\keystore\author\ebcorte.p12" -p 0000
call "%TIZEN_BIN%\tizen.bat" cli-config "profiles.path=%TIZEN_HOME%-data\profile\profiles.xml"

echo.
echo ===========================================================
echo   Listo. Cierra "Cartelera El Buen Corte" (icono en la bandeja
echo   o Detener Cartelera) y vuelve a abrirla para que el panel
echo   detecte las herramientas de Tizen en la pestana "TV".
echo ===========================================================
pause
