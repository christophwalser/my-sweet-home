# Builds the Windows installer (MSI) of My Sweet Home.
#
# 1. Copies Sweet Home 3D's default catalog (Furniture.jar, Textures.jar) from a Sweet Home 3D
#    installation into app/src-tauri/resources/catalog (never committed, see .gitignore).
# 2. Builds the CLI `msh` and places it where Tauri expects the external binary.
# 3. Builds the app and the MSI with tauri.installer.conf.json merged into the configuration.
#
# -Sign also creates the update artifacts (.msi.sig) for the Tauri updater. The private key is
# read from $env:TAURI_SIGNING_PRIVATE_KEY, or from %USERPROFILE%\.msh\updater.key, which is
# created on first use (keep it safe: updates can only be signed with it).
#
# Usage: .\scripts\build-installer.ps1 [-Sh3dDir 'C:\Program Files\Sweet Home 3D'] [-Sign]

param(
    [string]$Sh3dDir,
    [switch]$Sign
)

$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

$root = Split-Path $PSScriptRoot -Parent
$app = Join-Path $root 'app'
$tauri = Join-Path $app 'src-tauri'

# --- 1. Default catalog -------------------------------------------------------------------
function Find-Sh3dLib {
    $candidates = @()
    if ($Sh3dDir) { $candidates += $Sh3dDir }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($base) { $candidates += (Join-Path $base 'Sweet Home 3D') }
    }
    try {
        $store = (Get-AppxPackage -Name eTeks.SweetHome3D | Select-Object -First 1).InstallLocation
        if ($store) { $candidates += (Join-Path $store 'Sweet Home 3D') }
    } catch {}
    foreach ($dir in $candidates) {
        foreach ($lib in @((Join-Path $dir 'lib'), $dir)) {
            if ((Test-Path (Join-Path $lib 'Furniture.jar')) -and (Test-Path (Join-Path $lib 'Textures.jar'))) {
                return $lib
            }
        }
    }
    return $null
}

$lib = Find-Sh3dLib
if (-not $lib) {
    throw 'Sweet Home 3D default catalog not found. Install Sweet Home 3D or pass -Sh3dDir.'
}
$catalog = Join-Path $tauri 'resources\catalog'
foreach ($jar in @('Furniture.jar', 'Textures.jar')) {
    Copy-Item (Join-Path $lib $jar) (Join-Path $catalog $jar) -Force
}
Write-Host "Default catalog copied from $lib"

# Native tools write progress to stderr, which Windows PowerShell turns into errors when the
# output is redirected: from here on only exit codes count
$ErrorActionPreference = 'Continue'

# --- 2. CLI -------------------------------------------------------------------------------
Push-Location $root
try {
    cargo build --release -p msh-cli
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
