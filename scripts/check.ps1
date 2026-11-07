# Fuehrt alle Pruefungen aus: Formatierung, Lints, Tests (Rust + Frontend).
# Aufruf aus dem Repo-Root:  .\scripts\check.ps1
# 'Continue', weil PowerShell 5.1 stderr-Ausgaben von cargo sonst als Fehler wertet.
# Fehlschlaege werden ueber $LASTEXITCODE erkannt.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

function Step($name, [scriptblock]$cmd) {
    Write-Host "==> $name" -ForegroundColor Cyan
    & $cmd
    if ($LASTEXITCODE -ne 0) { throw "Fehlgeschlagen: $name" }
}

Push-Location $root
try {
    Step 'cargo fmt'    { cargo fmt --all -- --check }
    Step 'cargo clippy' { cargo clippy --workspace --all-targets -- -D warnings }
    Step 'cargo test'   { cargo test --workspace }
    Push-Location (Join-Path $root 'app')
    try {
        Step 'biome'      { pnpm lint }
        Step 'typescript' { pnpm typecheck }
    } finally { Pop-Location }
    Write-Host 'Alle Pruefungen bestanden.' -ForegroundColor Green
} finally { Pop-Location }
