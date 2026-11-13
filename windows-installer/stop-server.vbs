' Detiene el servidor de la cartelera (busca el node.exe que corre desde esta
' misma carpeta de instalación y lo cierra). Útil antes de desinstalar o para
' el acceso directo "Detener Cartelera".
Dim fso, scriptDir, objWMIService, colProcesses, objProcess

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set objWMIService = GetObject("winmgmts:\\.\root\cimv2")
Set colProcesses = objWMIService.ExecQuery("Select * from Win32_Process Where Name = 'node.exe'")

For Each objProcess in colProcesses
  If InStr(objProcess.CommandLine, scriptDir) > 0 Then
    objProcess.Terminate()
  End If
Next
