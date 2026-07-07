param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TauriArgs
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$nodeBin = Join-Path $root "node_modules\.bin"
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"

if (Test-Path -LiteralPath $nodeBin) {
  $pathParts = $env:PATH -split ";"
  $hasNodeBin = $pathParts | Where-Object {
    $_.TrimEnd("\") -ieq $nodeBin.TrimEnd("\")
  }

  if (-not $hasNodeBin) {
    $env:PATH = "$nodeBin;$env:PATH"
  }
}

if (Test-Path -LiteralPath (Join-Path $cargoBin "cargo.exe")) {
  $pathParts = $env:PATH -split ";"
  $hasCargoBin = $pathParts | Where-Object {
    $_.TrimEnd("\") -ieq $cargoBin.TrimEnd("\")
  }

  if (-not $hasCargoBin) {
    $env:PATH = "$cargoBin;$env:PATH"
  }
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "cargo was not found. Install Rust or add $cargoBin to PATH."
}

& tauri @TauriArgs
exit $LASTEXITCODE
