$ErrorActionPreference = "Stop"

$edgeCandidates = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) {
  throw "Microsoft Edge was not found; SVG and PNG figures are still available."
}

$figures = Join-Path $PSScriptRoot "figures"
Get-ChildItem -LiteralPath $figures -Filter "figure-*.svg" | ForEach-Object {
  $svg = Get-Content -LiteralPath $_.FullName -Raw
  $htmlPath = Join-Path $figures ($_.BaseName + ".print.html")
  $pdfPath = Join-Path $figures ($_.BaseName + ".pdf")
  $html = @"
<!doctype html>
<html><head><meta charset="utf-8"><style>
@page { size: 14in 9in; margin: 0; }
html, body { width: 14in; height: 9in; margin: 0; padding: 0; overflow: hidden; }
svg { display: block; width: 14in; height: 9in; }
</style></head><body>$svg</body></html>
"@
  Set-Content -LiteralPath $htmlPath -Value $html -Encoding utf8
  $uri = "file:///" + ($htmlPath -replace "\\", "/")
  $arguments = @(
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--print-to-pdf-no-header",
    "--print-to-pdf=$pdfPath",
    $uri
  )
  $process = Start-Process -FilePath $edge -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $pdfPath)) {
    throw "PDF export failed for $($_.Name)"
  }
  Remove-Item -LiteralPath $htmlPath -Force
  Write-Output "[pdf] $($_.BaseName).pdf"
}
