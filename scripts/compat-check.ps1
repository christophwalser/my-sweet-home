# Kompatibilitaetstest gegen das Original Sweet Home 3D:
# 1. Jede .sh3d aus tests\corpus\private wird mit "msh resave" neu gespeichert.
# 2. Original und neu gespeicherte Datei werden mit dem Leser aus
#    SweetHome3D.jar gelesen (tools\compat\ReadHome.java).
# 3. Die Zusammenfassungen (Anzahl Waende, Raeume, Moebel, Ressourcen-Bytes)
#    muessen uebereinstimmen.
#
# Voraussetzung: Sweet Home 3D installiert, JDK (javac/java) im PATH.
# Aufruf aus dem Repo-Root:  .\scripts\compat-check.ps1
param(
    [string]$Sh3dJar = 'C:\Program Files\Sweet Home 3D\lib\SweetHome3D.jar'
)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'target\compat'
New-Item -ItemType Directory -Force $out | Out-Null

if (-not (Test-Path $Sh3dJar)) { throw "SweetHome3D.jar nicht gefunden: $Sh3dJar" }

Push-Location $root
try {
    cargo build -q -p msh-cli
    if ($LASTEXITCODE -ne 0) { throw 'Build fehlgeschlagen' }
    javac -nowarn -cp $Sh3dJar -d $out tools\compat\ReadHome.java
    if ($LASTEXITCODE -ne 0) { throw 'javac fehlgeschlagen' }

    $files = Get-ChildItem tests\corpus\private -Filter *.sh3d -ErrorAction SilentlyContinue
    if (-not $files) { Write-Host 'Keine Dateien in tests\corpus\private' -ForegroundColor Yellow; exit 0 }

    $failed = $false
    foreach ($f in $files) {
        $resaved = Join-Path $out ($f.BaseName + '.resaved.sh3d')
        & .\target\debug\msh.exe resave $f.FullName $resaved | Out-Null
        if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Host "FAIL resave $($f.Name)"; continue }

        # Argument in Anfuehrungszeichen: PowerShell 5.1 trennt -D...=... sonst am Punkt
        $result = & java '-Djava.awt.headless=true' -cp "$Sh3dJar;$out" ReadHome $f.FullName $resaved
        $result | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) { $failed = $true; continue }

        # Zusammenfassung ohne Dateinamen vergleichen
        $summaries = $result | Where-Object { $_ -like 'OK*' } | ForEach-Object { ($_ -split '\) ', 2)[1] } | Sort-Object -Unique
        if (@($summaries).Count -ne 1) {
            $failed = $true
            Write-Host "FAIL $($f.Name): Original und neu gespeicherte Datei unterscheiden sich" -ForegroundColor Red
        } else {
            Write-Host "GLEICH $($f.Name): $summaries" -ForegroundColor Green
        }
    }
    if ($failed) { exit 1 }
    Write-Host 'Kompatibilitaetstest bestanden.' -ForegroundColor Green
} finally { Pop-Location }
