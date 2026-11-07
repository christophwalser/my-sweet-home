# Live control demo: builds a small house in the RUNNING app through the CLI
# (--live) and then uses the MCP server in live mode for plan and 3D images.
# Start the app first (e.g. target\debug\msh-app.exe), then run from the repo root:
#   .\scripts\live-demo.ps1
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'target\live-demo'
New-Item -ItemType Directory -Force $out | Out-Null
$msh = Join-Path $root 'target\debug\msh.exe'

function Live { & $msh --live @args | ConvertFrom-Json }

& $msh status | Out-Host
Live home new --name 'Live demo' | Out-Null
$outer = (Live wall add-path --points '[[0,0],[1000,0],[1000,700],[0,700]]' --closed --thickness 30).ids
Live wall add-path --points '[[600,15],[600,685]]' --thickness 12 | Out-Null
Live room add --name 'Living room' --points '[[15,15],[594,15],[594,685],[15,685]]' --floor-texture 'eTeks#woodenFloor' | Out-Null
Live room add --name 'Bedroom' --points '[[606,15],[985,15],[985,685],[606,685]]' --floor-color '#e8dcc0' | Out-Null
Live furniture add-in-wall --catalog-id 'eTeks#frontDoor' --wall-id $outer[2] --offset 700 | Out-Null
Live furniture add-in-wall --catalog-id 'eTeks#doubleWindow126x123' --wall-id $outer[0] --offset 300 | Out-Null
Live furniture add-in-wall --catalog-id 'eTeks#window85x123' --wall-id $outer[0] --offset 800 | Out-Null
Live furniture add-in-wall --catalog-id 'eTeks#doubleFrenchWindow126x200' --wall-id $outer[3] --offset 350 | Out-Null
Live furniture add --catalog-id 'eTeks#bed140x190' --x 800 --y 420 | Out-Null
Live furniture add --catalog-id 'eTeks#sofa' --x 300 --y 600 --angle-deg 180 | Out-Null
Live furniture add --catalog-id 'eTeks#squareTable' --x 300 --y 300 | Out-Null
Live label add --text 'Built live via CLI and MCP' --x 500 --y -60 | Out-Null

# MCP in live mode: tool list, plan image, 3D image, save
$lines = @(
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"live-demo","version":"1"}}}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}',
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"view_plan_image","arguments":{"width":900}}}',
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"view_3d_image","arguments":{"mode":"aerial"}}}',
    ('{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"home_save","arguments":{"path":' + (ConvertTo-Json (Join-Path $out 'live-demo.sh3d')) + '}}}')
)
$parsed = $lines | & $msh mcp --live | ForEach-Object { $_ | ConvertFrom-Json }
$tools = ($parsed | Where-Object { $_.id -eq 2 }).result.tools.name
Write-Host "MCP tools: $($tools.Count) (view_3d_image: $($tools -contains 'view_3d_image'))"
foreach ($pair in @(@(3, 'plan.png'), @(4, 'view3d.png'))) {
    $res = ($parsed | Where-Object { $_.id -eq $pair[0] }).result
    if ($res.isError) { throw "tool call $($pair[0]) failed: $($res.content[0].text)" }
    $img = $res.content | Where-Object { $_.type -eq 'image' }
    [IO.File]::WriteAllBytes((Join-Path $out $pair[1]), [Convert]::FromBase64String($img.data))
}
$save = ($parsed | Where-Object { $_.id -eq 5 }).result
if ($save.isError) { throw "home_save failed: $($save.content[0].text)" }
Write-Host "Saved and images written to $out" -ForegroundColor Green
