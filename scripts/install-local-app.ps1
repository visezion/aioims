$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonWindowless = Join-Path $projectRoot '.venv\Scripts\pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonWindowless)) {
    throw 'Install the project Python virtual environment and backend requirements first.'
}
Push-Location $projectRoot
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'The frontend build failed.' }
} finally { Pop-Location }

$desktopFolder = [Environment]::GetFolderPath('Desktop')
$programsFolder = [Environment]::GetFolderPath('Programs')
$shortcutShell = New-Object -ComObject WScript.Shell
foreach ($folder in @($desktopFolder, $programsFolder)) {
    $shortcutPath = Join-Path $folder 'AIMS.lnk'
    $shortcut = $shortcutShell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $pythonWindowless
    $shortcut.Arguments = '"' + (Join-Path $PSScriptRoot 'local_app.py') + '"'
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.Description = 'Start the local AIMS application'
    $shortcut.WindowStyle = 7
    $shortcut.Save()
    Write-Output "Created $shortcutPath"
}
