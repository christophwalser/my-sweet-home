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
    } finally { Pop-Location }
    Write-Host 'All checks passed.' -ForegroundColor Green
} finally { Pop-Location }
