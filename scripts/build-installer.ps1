# Builds the Windows installer (MSI) of My Sweet Home. Used locally and by the release
# workflow (.github/workflows/release.yml).
#
# 1. Collects the license files (LICENSE, NOTICE.md, generated THIRD-PARTY-NOTICES.txt) into
#    app/src-tauri/resources/legal (never committed, see .gitignore).
# 2. Builds the CLI `msh` and places it where Tauri expects the external binary.
# 3. Builds the app and the MSI with tauri.installer.conf.json merged into the configuration.
#
# No furniture or texture library is bundled: the app uses the libraries of an installed
# Sweet Home 3D and the ones the user imports or downloads.
#
# -Sign also creates the update artifacts (.msi.sig) for the Tauri updater. The private key is
# read from $env:TAURI_SIGNING_PRIVATE_KEY, or from %USERPROFILE%\.msh\updater.key, which is
# created on first use (keep it safe: updates can only be signed with it).
#
# Usage: .\scripts\build-installer.ps1 [-Sign]

param(
    [switch]$Sign
)

$ErrorActionPreference = 'Stop'
if (-not $env:CI) {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

$root = Split-Path $PSScriptRoot -Parent
$app = Join-Path $root 'app'
$tauri = Join-Path $app 'src-tauri'

# Native tools write progress to stderr, which Windows PowerShell turns into errors when the
# output is redirected: from here on only exit codes count
$ErrorActionPreference = 'Continue'

# --- 1. License files ---------------------------------------------------------------------
$legal = Join-Path $tauri 'resources\legal'
New-Item -ItemType Directory -Force $legal | Out-Null
Copy-Item (Join-Path $root 'LICENSE') (Join-Path $legal 'LICENSE.txt') -Force
Copy-Item (Join-Path $root 'NOTICE.md') (Join-Path $legal 'NOTICE.md') -Force
node (Join-Path $root 'scripts\third-party-notices.mjs') (Join-Path $legal 'THIRD-PARTY-NOTICES.txt')
if ($LASTEXITCODE -ne 0) { throw 'Collecting the third-party notices failed' }

# --- 2. CLI -------------------------------------------------------------------------------
Push-Location $root
try {
    cargo build --release --locked -p msh-cli
    if ($LASTEXITCODE -ne 0) { throw 'Building the CLI failed' }
    $triple = (rustc -vV | Select-String '^host: ').ToString().Substring(6).Trim()
} finally {
    Pop-Location
}
$binaries = Join-Path $tauri 'binaries'
New-Item -ItemType Directory -Force $binaries | Out-Null
Copy-Item (Join-Path $root 'target\release\msh.exe') (Join-Path $binaries "msh-$triple.exe") -Force
Write-Host "CLI copied as msh-$triple.exe"

# --- 3. App and MSI -----------------------------------------------------------------------
$configs = @('--config', 'src-tauri/tauri.installer.conf.json')
if ($Sign) {
    if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
        $keyFile = Join-Path $env:USERPROFILE '.msh\updater.key'
        if (-not (Test-Path $keyFile)) {
            New-Item -ItemType Directory -Force (Split-Path $keyFile) | Out-Null
            Push-Location $app
            try {
                pnpm tauri signer generate --ci -p '""' -w $keyFile
                if ($LASTEXITCODE -ne 0) { throw 'Creating the updater key failed' }
            } finally {
                Pop-Location
            }
            Write-Host "Updater key created: $keyFile (public key: $keyFile.pub)"
        }
        $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $keyFile -Raw
        if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '' }
    }
    $signConfig = Join-Path $root 'target\tauri.sign.conf.json'
    '{ "bundle": { "createUpdaterArtifacts": true } }' | Out-File -Encoding ascii $signConfig
    $configs += @('--config', $signConfig)
}

Push-Location $app
try {
    pnpm tauri build @configs
    if ($LASTEXITCODE -ne 0) { throw 'Building the installer failed' }
} finally {
    Pop-Location
}

$msi = Get-ChildItem (Join-Path $root 'target\release\bundle\msi') -Filter '*.msi' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host "Installer: $($msi.FullName) ($([math]::Round($msi.Length / 1MB, 1)) MB)"
