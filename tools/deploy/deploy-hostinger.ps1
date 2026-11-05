# Wrapper PowerShell pour déployer l'application sur Hostinger (https://app-eagleseye.com)
# Usage depuis PowerShell :
#   .\tools\deploy\deploy-hostinger.ps1
#   .\tools\deploy\deploy-hostinger.ps1 --skip-build

$ErrorActionPreference = 'Stop'

$gitBash = "C:\Program Files\Git\bin\bash.exe"
if (-not (Test-Path $gitBash)) {
    $cmd = Get-Command bash.exe -ErrorAction SilentlyContinue
    if ($null -ne $cmd) {
        $gitBash = $cmd.Source
    } else {
        Write-Error "Git Bash (C:\Program Files\Git\bin\bash.exe) est introuvable."
        exit 1
    }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $repoRoot
try {
    & $gitBash "tools/deploy/deploy-hostinger.sh" @args
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
