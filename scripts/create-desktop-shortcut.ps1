param([string]$DesktopPath = [Environment]::GetFolderPath('Desktop'))
$ErrorActionPreference = 'Stop'
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$desktopFullPath = [IO.Path]::GetFullPath($DesktopPath)
if (-not (Test-Path -LiteralPath $desktopFullPath -PathType Container)) { throw 'Desktop folder does not exist.' }
$shortcutName = 'Kotoba ' + [char]0x5B66 + [char]0x4E60 + [char]0x5BA4 + '.lnk'
$shortcutPath = Join-Path $desktopFullPath $shortcutName
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + (Join-Path $projectPath 'scripts\start-hidden.vbs') + '"'
$shortcut.WorkingDirectory = $projectPath
$shortcut.Description = 'Open Kotoba local course library'
$shortcut.IconLocation = (Join-Path $projectPath 'public\app.ico') + ',0'
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output $shortcutPath
