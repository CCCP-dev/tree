[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Output
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Clean-Name([string]$value) {
  if ($null -eq $value) { return '' }
  $value = [regex]::Replace($value, '(?i)<br\s*/?>|</div\s*>', "`n")
  $value = [regex]::Replace($value, '(?s)<[^>]*>', '')
  $value = [Net.WebUtility]::HtmlDecode($value)
  $lines = $value -split "`r?`n" | ForEach-Object { $_.Trim() }
  (($lines -join "`n") -replace "`n{2,}", "`n").Trim()
}

function Read-ZipText($zip, [string]$name) {
  $entry = $zip.GetEntry($name)
  if ($null -eq $entry) { throw "Missing archive entry: $name" }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

$zip = [IO.Compression.ZipFile]::OpenRead($Source)
try {
  $meta = Read-ZipText $zip 'meta.json' | ConvertFrom-Json
  $canvasId = [string]$meta.mainCanvasId
  $diagram = Read-ZipText $zip "$canvasId.pos" | ConvertFrom-Json
} finally { $zip.Dispose() }

$elements = @($diagram.diagram.elements.elements.PSObject.Properties | ForEach-Object { $_.Value })
$nodeElements = @($elements | Where-Object { $_.props -and $_.textBlock })
$nodesById = @{}
$nodeRects = @()
$nodes = foreach ($element in $nodeElements) {
  $nameText = (($element.textBlock | ForEach-Object { [string]$_.text }) -join "`n")
  $id = [string]$element.id
  $wikiUrl = if ($element.link) { [string]$element.link } else { $null }
  if ($id -eq 'EQLcHxEAXy265141') {
    $wikiUrl = 'https://wiki.warthunder.com/unit/us_m4a3e2_76w_sherman_jumbo'
  }
  $node = [ordered]@{
    id = $id
    name = Clean-Name $nameText
    wikiUrl = $wikiUrl
    originalX = [double]$element.props.x
    originalY = [double]$element.props.y
    width = [double]$element.props.w
    height = [double]$element.props.h
  }
  $nodesById[$node.id] = $node
  $nodeRects += [pscustomobject]@{ id=$node.id; x=$node.originalX; y=$node.originalY; w=$node.width; h=$node.height }
  [pscustomobject]$node
}

function Resolve-Endpoint($endpoint) {
  $endpointId = [string]$endpoint.id
  if (-not [string]::IsNullOrWhiteSpace($endpointId)) {
    if ($nodesById.ContainsKey($endpointId)) {
      return @{ id=$endpointId; inferred=$false }
    }
    throw "Unknown linker endpoint ID: $endpointId"
  }
  $x=[double]$endpoint.x; $y=[double]$endpoint.y
  $candidates = foreach ($rect in $nodeRects) {
    $dx = [Math]::Max([Math]::Max($rect.x - $x, 0), $x - ($rect.x + $rect.w))
    $dy = [Math]::Max([Math]::Max($rect.y - $y, 0), $y - ($rect.y + $rect.h))
    [pscustomobject]@{ id=$rect.id; distance=[Math]::Sqrt($dx*$dx + $dy*$dy) }
  }
  $ordered=@($candidates | Sort-Object distance)
  if ($ordered.Count -eq 0 -or $ordered[0].distance -gt 70 -or ($ordered.Count -gt 1 -and [Math]::Abs($ordered[0].distance-$ordered[1].distance) -lt 0.0001)) {
    throw "Unable to resolve linker endpoint at ($x,$y) reliably"
  }
  return @{ id=$ordered[0].id; inferred=$true }
}

$edges = foreach ($linker in @($elements | Where-Object { $_.name -eq 'linker' })) {
  $from = Resolve-Endpoint $linker.from
  $to = Resolve-Endpoint $linker.to
  [pscustomobject][ordered]@{ id=[string]$linker.id; from=$from.id; to=$to.id; inferred=($from.inferred -or $to.inferred) }
}
$nodes = @($nodes | Sort-Object -Property @{Expression={ [string]$_.id }; Ascending=$true})
$edges = @($edges | Sort-Object -Property @{Expression={ [string]$_.id }; Ascending=$true})
if ($nodes.Count -ne 122 -or $edges.Count -ne 195) { throw "Unexpected counts: nodes=$($nodes.Count) edges=$($edges.Count)" }
$linkedCount = @($nodes | Where-Object { $_.wikiUrl }).Count
$inferredCount = @($edges | Where-Object { $_.inferred }).Count
if ($linkedCount -ne 111 -or $inferredCount -ne 2) { throw "Unexpected links: links=$linkedCount inferred=$inferredCount" }
$data = [ordered]@{ meta=[ordered]@{ mainCanvasId=$canvasId }; nodes=$nodes; edges=$edges }
$json = $data | ConvertTo-Json -Depth 10 -Compress
$parent = Split-Path -Parent $Output
if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
[IO.File]::WriteAllText($Output, "globalThis.WT_TREE_DATA = Object.freeze($json);`n", [Text.UTF8Encoding]::new($false))
Write-Output "nodes=$($nodes.Count) edges=$($edges.Count) links=$linkedCount inferred=$inferredCount"
