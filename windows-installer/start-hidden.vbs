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

' Espera a que el servidor termine de levantar antes de abrir la ventana —
' probando de verdad que responda, no una pausa fija. Una pausa fija corta
' (2.5s) alcanzaba casi siempre, pero fallaba justo en el peor momento: un
' arranque lento del PC (antivirus revisando los archivos recien
' instalados, varios programas de inicio compitiendo a la vez), que es
' exactamente cuando alguien llega al local y mira el panel por primera vez
' ese dia. Reintenta hasta 30 segundos antes de abrir la ventana igual.
' Un objeto WinHttpRequest nuevo en CADA intento, no uno solo reusado para
' los 60 — reusar el mismo objeto después de que el primer intento falla
' (el servidor recién está arrancando, lo más común) lo deja en un estado
' que nunca vuelve a detectar una respuesta válida después, así que el
' bucle siempre terminaba agotando los 30 segundos completos aunque el
' servidor ya llevara rato respondiendo bien.
Dim attempt, ready, http
ready = False
For attempt = 1 To 60
  On Error Resume Next
  Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
  http.Open "GET", adminUrl, False
  http.Send
  If Err.Number = 0 And http.Status > 0 Then ready = True
  Err.Clear
  On Error Goto 0
  If ready Then Exit For
  WScript.Sleep 500
Next

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
