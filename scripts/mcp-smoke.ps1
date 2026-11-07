# Smoke test of the MCP server: speaks JSON-RPC like an AI client, builds a small
# house through tools/call, saves it and checks the file with the original
# Sweet Home 3D reader (if installed).
# Usage from the repository root:  .\scripts\mcp-smoke.ps1
$ErrorActionPreference = 'Continue'
# Pipe UTF-8 without byte order mark to the native process
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'target\mcp-smoke'
New-Item -ItemType Directory -Force $out | Out-Null
$house = Join-Path $out 'mcp-house.sh3d'
Remove-Item $house -ErrorAction SilentlyContinue

Push-Location $root
try {
    cargo build -q -p msh-cli
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }

    $script:id = 0
    function Req($method, $params) {
        $script:id++
        return (@{ jsonrpc = '2.0'; id = $script:id; method = $method; params = $params } | ConvertTo-Json -Depth 20 -Compress)
    }
    function Call($name, $arguments) { return Req 'tools/call' @{ name = $name; arguments = $arguments } }

    # Wall IDs are not known in advance, so the house uses the wall path and
    # places doors/windows in a second session after reading the IDs.
    $lines = @(
        (Req 'initialize' @{ protocolVersion = '2025-06-18'; capabilities = @{}; clientInfo = @{ name = 'smoke'; version = '1' } }),
        '{"jsonrpc":"2.0","method":"notifications/initialized"}',
        (Req 'tools/list' @{}),
        (Call 'home_new' @{ name = 'MCP house' }),
        (Call 'wall_add_path' @{ points = @(@(0, 0), @(800, 0), @(800, 600), @(0, 600)); closed = $true; thickness = 25 }),
        (Call 'room_add' @{ name = 'Studio'; points = @(@(12.5, 12.5), @(787.5, 12.5), @(787.5, 587.5), @(12.5, 587.5)); floor_texture = 'eTeks#woodenFloor' }),
        (Call 'catalog_search' @{ query = 'door'; limit = 3 }),
        (Call 'home_describe' @{}),
        (Call 'home_save' @{ path = $house })
    )
    $responses = $lines | & .\target\debug\msh.exe mcp
    $parsed = $responses | ForEach-Object { $_ | ConvertFrom-Json }
    $tools = ($parsed | Where-Object { $_.id -eq 2 }).result.tools
    Write-Host "Tools: $($tools.Count)"
    $describe = ($parsed | Where-Object { $_.id -eq 7 }).result.structuredContent
    $wallId = $describe.walls[0].id
    $errors = $parsed | Where-Object { $_.error -or $_.result.isError }
    if ($errors) { $errors | ForEach-Object { Write-Host ($_ | ConvertTo-Json -Depth 6) -ForegroundColor Red }; exit 1 }

    # Second session: open the saved file, add door, window, furniture, image, save
    $script:id = 0
    $lines = @(
        (Req 'initialize' @{ protocolVersion = '2025-06-18'; capabilities = @{}; clientInfo = @{ name = 'smoke'; version = '1' } }),
        (Call 'home_open' @{ path = $house }),
        (Call 'furniture_add_in_wall' @{ catalog_id = 'eTeks#door'; wall_id = $wallId; offset = 150 }),
        (Call 'furniture_add_in_wall' @{ catalog_id = 'eTeks#window85x123'; wall_id = $wallId; offset = 550 }),
        (Call 'furniture_add' @{ catalog_id = 'eTeks#bed140x190'; x = 600; y = 380 }),
        (Call 'furniture_add' @{ catalog_id = 'eTeks#sofa'; x = 250; y = 480; angle_deg = 180 }),
        (Call 'view_plan_image' @{ width = 800 }),
        (Call 'home_save' @{})
    )
    $parsed = $lines | & .\target\debug\msh.exe mcp | ForEach-Object { $_ | ConvertFrom-Json }
    $errors = $parsed | Where-Object { $_.error -or $_.result.isError }
    if ($errors) { $errors | ForEach-Object { Write-Host ($_ | ConvertTo-Json -Depth 6) -ForegroundColor Red }; exit 1 }
    $image = ($parsed | Where-Object { $_.id -eq 7 }).result.content | Where-Object { $_.type -eq 'image' }
    [IO.File]::WriteAllBytes((Join-Path $out 'mcp-house.png'), [Convert]::FromBase64String($image.data))
    Write-Host "MCP session OK: $house"

    # Verify with the original Sweet Home 3D reader
    $jar = 'C:\Program Files\Sweet Home 3D\lib\SweetHome3D.jar'
    if (Test-Path $jar) {
        javac -nowarn -cp $jar -d $out tools\compat\ReadHome.java
        & java '-Djava.awt.headless=true' -cp "$jar;$out" ReadHome $house
        if ($LASTEXITCODE -ne 0) { throw 'Sweet Home 3D cannot read the generated file' }
    }
    Write-Host 'MCP smoke test passed.' -ForegroundColor Green
} finally { Pop-Location }
