@echo off
REM Arranca el servidor de la cartelera y abre la TV en modo kiosko.
REM Pensado para correr en el mismo PC del POS, con la TV como segundo monitor (HDMI).

REM --- Ajusta esta linea segun donde quede la TV en Windows (ver README, paso 2) ---
set POSICION_VENTANA=1920,0

cd /d "%~dp0..\.."

echo Iniciando servidor de cartelera...
start "Cartelera - Servidor" /min cmd /c "npm start"

echo Esperando a que el servidor levante...
timeout /t 4 /nobreak >nul

echo Abriendo la pantalla de la TV en modo kiosko...
start "" chrome --kiosk --noerrdialogs --disable-infobars --window-position=%POSICION_VENTANA% http://localhost:4010/player/1
