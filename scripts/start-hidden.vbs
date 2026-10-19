Option Explicit
Dim shell, fs, project, result
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
project = fs.GetParentFolderName(fs.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = project
If Not fs.FolderExists(project & "\data") Then fs.CreateFolder(project & "\data")
result = shell.Run("cmd.exe /d /c node scripts\launch.mjs > data\launcher.log 2>&1", 0, True)
If result <> 0 Then
  MsgBox "Kotoba could not start. Please open data\launcher.log. Node.js 24+ is required.", 48, "Kotoba"
End If
