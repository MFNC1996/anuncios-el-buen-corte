' Arranca el servidor de la cartelera sin mostrar ninguna ventana de consola,
' y abre el panel de administracion como una ventana de aplicacion propia
' (con su propio icono en la barra de tareas, no como una pestana mas del
' navegador) usando el modo --app de Chrome o Edge. Si no encuentra ninguno,
' lo abre en el navegador por defecto de la forma normal.
' Vive en la carpeta de instalacion, junto a node-runtime\ y server\.
Dim objShell, fso, scriptDir, cmd, adminUrl, browserPath, candidates, i

Set objShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
adminUrl = "http://localhost:4010/admin"

' Rutas absolutas (no relativas) para node.exe y server\index.js: asi el
' proceso queda registrado en Windows con la carpeta de instalacion en su
' propia linea de comando, que es justo lo que stop-server.vbs busca para
' identificar y cerrar el proceso correcto.
nodeExe = scriptDir & "\node-runtime\node.exe"
serverJs = scriptDir & "\server\index.js"
cmd = "cmd /c cd /d """ & scriptDir & """ && """ & nodeExe & """ """ & serverJs & """"
objShell.Run cmd, 0, False

' Espera a que el servidor termine de levantar antes de abrir la ventana.
WScript.Sleep 2500

candidates = Array( _
  objShell.ExpandEnvironmentStrings("%ProgramFiles%\Google\Chrome\Application\chrome.exe"), _
  objShell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"), _
  objShell.ExpandEnvironmentStrings("%LocalAppData%\Google\Chrome\Application\chrome.exe"), _
  objShell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"), _
  objShell.ExpandEnvironmentStrings("%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") _
)

browserPath = ""
For i = 0 To UBound(candidates)
  If fso.FileExists(candidates(i)) Then
    browserPath = candidates(i)
    Exit For
  End If
Next

If browserPath <> "" Then
  objShell.Run """" & browserPath & """ --app=" & adminUrl & " --window-size=1280,800", 1, False
Else
  objShell.Run adminUrl, 1, False
End If
