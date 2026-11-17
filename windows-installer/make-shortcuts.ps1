# Crea los accesos directos del instalador. Antes esto vivía como un bloque
# "powershell -Command "..." ^ "..." ^ ..." adentro de INSTALAR.bat, armado a
# mano con comillas simples de PowerShell anidadas dentro de comillas dobles
# de CMD. Esa mezcla nunca ponía comillas alrededor de la ruta guardada en
# "Arguments" del acceso directo — si el perfil de Windows tiene un espacio
# en el nombre (ej. "Juan Perez", nada raro), wscript.exe partía esa ruta en
# dos argumentos al abrir el acceso directo y nunca encontraba el script.
# Como script .ps1 aparte, cada ruta llega ya separada como parámetro (sin
# depender de que CMD la vuelva a citar bien) y se puede envolver en
# comillas reales antes de guardarla.
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$StartMenuDir,
  [Parameter(Mandatory = $true)][string]$StartupDir,
  [Parameter(Mandatory = $true)][string]$DesktopDir,
  [Parameter(Mandatory = $true)][string]$AppName
)

function Quote([string]$Path) {
  return '"' + $Path + '"'
}

$ws = New-Object -ComObject WScript.Shell
$wscriptExe = Join-Path $env:WINDIR 'System32\wscript.exe'
$startVbs = Quote (Join-Path $InstallDir 'start-hidden.vbs')
$stopVbs = Quote (Join-Path $InstallDir 'stop-server.vbs')
$icon = Join-Path $InstallDir 'app.ico'

function MakeShortcut([string]$LnkPath, [string]$TargetPath, [string]$Arguments) {
  $s = $ws.CreateShortcut($LnkPath)
  $s.TargetPath = $TargetPath
  $s.Arguments = $Arguments
  $s.WorkingDirectory = $InstallDir
  $s.IconLocation = $icon
  $s.Save()
}

MakeShortcut (Join-Path $StartMenuDir "$AppName.lnk") $wscriptExe $startVbs
MakeShortcut (Join-Path $StartMenuDir 'Detener Cartelera.lnk') $wscriptExe $stopVbs
MakeShortcut (Join-Path $StartMenuDir 'Desinstalar.lnk') (Join-Path $InstallDir 'DESINSTALAR.bat') ''
MakeShortcut (Join-Path $DesktopDir "$AppName.lnk") $wscriptExe $startVbs
MakeShortcut (Join-Path $StartupDir "$AppName.lnk") $wscriptExe $startVbs
