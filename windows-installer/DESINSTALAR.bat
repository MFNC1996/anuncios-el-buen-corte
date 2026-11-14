@echo off
setlocal
set "APP_NAME=Cartelera El Buen Corte"
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\%APP_NAME%"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\%APP_NAME%.lnk"

set "SELF_DIR=%~dp0"
set "SELF_DIR=%SELF_DIR:~0,-1%"

REM Este .bat se relanza desde %TEMP% para poder borrar su propia carpeta
REM de instalacion (no se puede borrar una carpeta desde un .bat que sigue
REM corriendo adentro de ella).
if /i not "%SELF_DIR%"=="%TEMP%" (
  copy /y "%~f0" "%TEMP%\CarteleraDesinstalar.bat" >nul
  start "" "%TEMP%\CarteleraDesinstalar.bat" "%SELF_DIR%"
  exit /b
)

set "TARGET=%~1"
if "%TARGET%"=="" (
  echo No se encontro la carpeta de instalacion.
  pause
  exit /b 1
)

echo Desinstalando %APP_NAME%...
echo Esto borra tambien las fotos y datos guardados en el panel.
set /p CONFIRM="Escribe SI para continuar: "
if /i not "%CONFIRM%"=="SI" (
  echo Cancelado.
  pause
  exit /b 0
)

echo Deteniendo el servidor...
wscript "%TARGET%\stop-server.vbs"
timeout /t 2 /nobreak >nul

echo Quitando accesos directos...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Remove-Item -Recurse -Force -ErrorAction SilentlyContinue '%STARTMENU%';" ^
  "Remove-Item -Force -ErrorAction SilentlyContinue '%USERPROFILE%\Desktop\Cartelera El Buen Corte.lnk';" ^
  "Remove-Item -Force -ErrorAction SilentlyContinue '%STARTUP%'"

reg delete "HKCU\Software\CarteleraElBuenCorte" /f >nul 2>&1

echo Borrando archivos...
rmdir /s /q "%TARGET%"

echo.
echo Listo. Cartelera El Buen Corte fue desinstalada.
pause
del "%~f0"
