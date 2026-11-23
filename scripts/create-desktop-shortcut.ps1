param(
  [string]$ShortcutName = "Founder Virtual Office.lnk"
)

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$TargetCmd = Join-Path $RepoRoot "scripts\start-desktop.cmd"
$DesktopDir = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopDir $ShortcutName

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetCmd
$Shortcut.WorkingDirectory = $RepoRoot.Path
$Shortcut.WindowStyle = 7
$Shortcut.Description = "Launch Founder Virtual Office in Standalone Desktop App Mode"
$Shortcut.Save()

Write-Output "Created shortcut: $ShortcutPath -> $TargetCmd"
