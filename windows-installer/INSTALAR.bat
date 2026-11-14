@echo off
setlocal enabledelayedexpansion
title Instalando Cartelera El Buen Corte...

set "SRC=%~dp0"
set "SRC=%SRC:~0,-1%"
set "INSTALL_DIR=%LOCALAPPDATA%\CarteleraElBuenCorte"
set "APP_NAME=Cartelera El Buen Corte"
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\%APP_NAME%"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

echo.
echo ===========================================================
echo   Instalando %APP_NAME%
echo ===========================================================
echo.
echo Se instalara en:
echo   %INSTALL_DIR%
echo.

echo [1/5] Copiando archivos...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
robocopy "%SRC%\app" "%INSTALL_DIR%" /E /NFL /NDL /NJH /NJS /NC /NS >nul
if %ERRORLEVEL% GEQ 8 (
  echo Error copiando la app. Codigo: %ERRORLEVEL%
  pause
  exit /b 1
)
robocopy "%SRC%\node-runtime" "%INSTALL_DIR%\node-runtime" /E /NFL /NDL /NJH /NJS /NC /NS >nul
if %ERRORLEVEL% GEQ 8 (
  echo Error copiando Node.js. Codigo: %ERRORLEVEL%
  pause
  exit /b 1
)
copy /y "%SRC%\start-hidden.vbs" "%INSTALL_DIR%\start-hidden.vbs" >nul
copy /y "%SRC%\stop-server.vbs" "%INSTALL_DIR%\stop-server.vbs" >nul
copy /y "%SRC%\reinstalar-dependencias.bat" "%INSTALL_DIR%\reinstalar-dependencias.bat" >nul
copy /y "%SRC%\DESINSTALAR.bat" "%INSTALL_DIR%\DESINSTALAR.bat" >nul
copy /y "%SRC%\app.ico" "%INSTALL_DIR%\app.ico" >nul

echo [2/5] Instalando dependencias (necesita internet la primera vez)...
pushd "%INSTALL_DIR%"
call "node-runtime\npm.cmd" install --omit=dev --no-fund --no-audit
set "NPM_RESULT=%ERRORLEVEL%"
popd
if not "%NPM_RESULT%"=="0" (
  echo.
  echo AVISO: no se pudieron instalar las dependencias ahora mismo ^(revisa tu
  echo conexion a internet^). Mas tarde puedes reintentarlo ejecutando:
  echo   %INSTALL_DIR%\reinstalar-dependencias.bat
  echo.
  pause
)

echo [3/5] Creando accesos directos...
if not exist "%STARTMENU%" mkdir "%STARTMENU%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$s = $ws.CreateShortcut('%STARTMENU%\Cartelera El Buen Corte.lnk'); $s.TargetPath = '%WINDIR%\System32\wscript.exe'; $s.Arguments = '%INSTALL_DIR%\start-hidden.vbs'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.IconLocation = '%INSTALL_DIR%\app.ico'; $s.Save();" ^
  "$s = $ws.CreateShortcut('%STARTMENU%\Detener Cartelera.lnk'); $s.TargetPath = '%WINDIR%\System32\wscript.exe'; $s.Arguments = '%INSTALL_DIR%\stop-server.vbs'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.IconLocation = '%INSTALL_DIR%\app.ico'; $s.Save();" ^
  "$s = $ws.CreateShortcut('%STARTMENU%\Desinstalar.lnk'); $s.TargetPath = '%INSTALL_DIR%\DESINSTALAR.bat'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.IconLocation = '%INSTALL_DIR%\app.ico'; $s.Save();" ^
  "$s = $ws.CreateShortcut('%USERPROFILE%\Desktop\Cartelera El Buen Corte.lnk'); $s.TargetPath = '%WINDIR%\System32\wscript.exe'; $s.Arguments = '%INSTALL_DIR%\start-hidden.vbs'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.IconLocation = '%INSTALL_DIR%\app.ico'; $s.Save();" ^
  "$s = $ws.CreateShortcut('%STARTUP%\%APP_NAME%.lnk'); $s.TargetPath = '%WINDIR%\System32\wscript.exe'; $s.Arguments = '%INSTALL_DIR%\start-hidden.vbs'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.IconLocation = '%INSTALL_DIR%\app.ico'; $s.Save();"

echo [4/5] Dejando registrado el programa...
reg add "HKCU\Software\CarteleraElBuenCorte" /v InstallDir /t REG_SZ /d "%INSTALL_DIR%" /f >nul

echo [5/5] Iniciando la cartelera...
wscript "%INSTALL_DIR%\start-hidden.vbs"

echo.
echo ===========================================================
echo   Listo. Abre "Panel de Cartelera" desde el Escritorio o el
echo   menu Inicio para cambiar precios y fotos.
echo   La cartelera ya va a arrancar sola cuando prendas el PC.
echo ===========================================================
echo.
pause
