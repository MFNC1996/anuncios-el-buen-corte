' Arranca el servidor de la cartelera sin mostrar ninguna ventana de consola,
' y abre el panel de administracion en el navegador por defecto.
' Vive en la carpeta de instalacion, junto a node-runtime\ y server\.
Dim objShell, fso, scriptDir, cmd

Set objShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

cmd = "cmd /c cd /d """ & scriptDir & """ && ""node-runtime\node.exe"" ""server\index.js"""
objShell.Run cmd, 0, False

' Espera a que el servidor termine de levantar antes de abrir el navegador.
WScript.Sleep 2500
objShell.Run "http://localhost:4010/admin", 1, False
