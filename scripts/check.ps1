# Runs all checks: formatting, lints, tests (Rust + frontend).
# Usage from the repository root:  .\scripts\check.ps1
# 'Continue', because PowerShell 5.1 otherwise treats stderr output of cargo as an error.
# Failures are detected through $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

function Step($name, [scriptblock]$cmd) {
    Write-Host "==> $name" -ForegroundColor Cyan
    & $cmd
    if ($LASTEXITCODE -ne 0) { throw "Failed: $name" }
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
        Step 'vitest'     { pnpm test }
        Step 'i18n'       { node scripts/i18n-check.mjs }
    } finally { Pop-Location }
    # Files written by msh, read with the original Sweet Home 3D (needs Sweet Home 3D and a JDK)
    $sh3dJar = 'C:\Program Files\Sweet Home 3D\lib\SweetHome3D.jar'
    if ((Test-Path $sh3dJar) -and (Get-Command javac -ErrorAction SilentlyContinue)) {
        Step 'compat-check' { & (Join-Path $PSScriptRoot 'compat-check.ps1') -Sh3dJar $sh3dJar }
    } else {
        Write-Host '==> compat-check skipped (Sweet Home 3D or JDK not found)' -ForegroundColor Yellow
    }
    Write-Host 'All checks passed.' -ForegroundColor Green
} finally { Pop-Location }
