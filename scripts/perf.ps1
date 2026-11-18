# Performance run of the real app: opens a home, runs typical edits through the same path as
# the user's actions and prints how long every stage took (core, transfer to the window, plan,
# 3D view). Close the app first; it is started and ended by this script.
#   .\scripts\perf.ps1                         # debug build, example home
#   .\scripts\perf.ps1 -Release -Home my.sh3d
param(
    [string]$HomeFile = '',
    [switch]$Release,
    [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root ("target\{0}\msh-app.exe" -f $(if ($Release) { 'release' } else { 'debug' }))
if (-not (Test-Path $exe)) { throw "Build the app first: $exe" }
if (-not $HomeFile) { $HomeFile = Join-Path $root 'tests\corpus\examples\4BedroomHouse.sh3d' }
$HomeFile = (Resolve-Path $HomeFile).Path
if (-not $Out) { $Out = Join-Path $root 'target\perf\report.json' }
New-Item -ItemType Directory -Force (Split-Path -Parent $Out) | Out-Null
Remove-Item $Out -ErrorAction SilentlyContinue
if (Get-Process msh-app -ErrorAction SilentlyContinue) { throw 'Close My Sweet Home first.' }

$env:MSH_PERF_OUT = $Out
try {
    $p = Start-Process -FilePath $exe -ArgumentList ('"{0}"' -f $HomeFile) -PassThru
    if (-not $p.WaitForExit(300000)) { $p.Kill(); throw 'The performance run did not finish.' }
} finally {
    Remove-Item Env:MSH_PERF_OUT
}
$r = Get-Content $Out -Raw -Encoding UTF8 | ConvertFrom-Json
if ($r.error) { throw "Performance run failed: $($r.error)" }
"{0}: {1} walls, {2} rooms, {3} pieces; window {4}x{5}" -f (Split-Path -Leaf $r.home.path),
    $r.home.walls, $r.home.rooms, $r.home.pieces, $r.window[0], $r.window[1]
if ($r.errors) { "Errors in the window: $($r.errors -join '; ')" }
"A call to the backend and back, window idle: $($r.roundtripMs) ms"
# All times in ms from the start of the command, medians of the rounds
$r.steps | ForEach-Object {
    $m = $_.median
    [pscustomobject]@{
        Step      = $_.step
        Core      = $m.coreRun
        State     = $m.coreView
        Send      = $m.coreEmit
        Result    = $m.result
        Arrived   = $m.event
        Applied   = $m.applied
        Plan      = $m.planDrawn
        Done      = $m.commit
        Shown     = $m.painted
        '3D'      = $m.render3d
        Worst     = $_.worst.painted
        KB        = [math]::Round($m.bytes / 1024)
    }
} | Format-Table -AutoSize
"Report: $Out"
