' Arranca el servidor de la cartelera sin mostrar ninguna ventana de consola.
' Vive en la carpeta de instalación, junto a node-runtime\ y server\.
Dim objShell, fso, scriptDir, cmd

Set objShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

cmd = "cmd /c cd /d """ & scriptDir & """ && ""node-runtime\node.exe"" ""server\index.js"""
objShell.Run cmd, 0, False
