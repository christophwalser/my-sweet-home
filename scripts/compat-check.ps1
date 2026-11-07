# Compatibility test against the original Sweet Home 3D:
# 1. Every .sh3d in tests\corpus\private is saved again with "msh resave".
# 2. The original and the resaved file are read with the reader from
#    SweetHome3D.jar (tools\compat\ReadHome.java).
# 3. The summaries (number of walls, rooms, furniture, resource bytes)
#    must be identical.
#
# Requirements: Sweet Home 3D installed, JDK (javac/java) in PATH.
# Usage from the repository root:  .\scripts\compat-check.ps1
param(
    [string]$Sh3dJar = 'C:\Program Files\Sweet Home 3D\lib\SweetHome3D.jar'
)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'target\compat'
New-Item -ItemType Directory -Force $out | Out-Null

if (-not (Test-Path $Sh3dJar)) { throw "SweetHome3D.jar not found: $Sh3dJar" }

Push-Location $root
try {
    cargo build -q -p msh-cli
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    javac -nowarn -cp $Sh3dJar -d $out tools\compat\ReadHome.java
    if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

    $files = Get-ChildItem tests\corpus\private -Filter *.sh3d -ErrorAction SilentlyContinue
    if (-not $files) { Write-Host 'No files in tests\corpus\private' -ForegroundColor Yellow; exit 0 }

    $failed = $false
    foreach ($f in $files) {
        $resaved = Join-Path $out ($f.BaseName + '.resaved.sh3d')
        & .\target\debug\msh.exe resave $f.FullName $resaved | Out-Null
        if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Host "FAIL resave $($f.Name)"; continue }

        # Quoted argument: PowerShell 5.1 otherwise splits -D...=... at the dot
        $result = & java '-Djava.awt.headless=true' -cp "$Sh3dJar;$out" ReadHome $f.FullName $resaved
        $result | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) { $failed = $true; continue }

        # Compare the summaries without file names
        $summaries = $result | Where-Object { $_ -like 'OK*' } | ForEach-Object { ($_ -split '\) ', 2)[1] } | Sort-Object -Unique
        if (@($summaries).Count -ne 1) {
            $failed = $true
            Write-Host "FAIL $($f.Name): original and resaved file differ" -ForegroundColor Red
        } else {
            Write-Host "SAME $($f.Name): $summaries" -ForegroundColor Green
        }
    }
    if ($failed) { exit 1 }
    Write-Host 'Compatibility test passed.' -ForegroundColor Green
} finally { Pop-Location }
