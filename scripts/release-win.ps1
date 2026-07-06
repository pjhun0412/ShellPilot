$ErrorActionPreference = "Stop"

param(
  [string]$Tag
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$package = Get-Content -LiteralPath "package.json" | ConvertFrom-Json
$version = $package.version

if ([string]::IsNullOrWhiteSpace($Tag)) {
  $Tag = "v$version"
}

$assetDir = Join-Path $root "release-assets"
$portableSource = Join-Path $root "src-tauri\target\release\ShellPilot.exe"
$nsisDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
$portableAsset = Join-Path $assetDir "ShellPilot-$version-portable.exe"
$setupAsset = Join-Path $assetDir "ShellPilot-$version-setup.exe"

Write-Host "Building ShellPilot $version Windows installer..."
npm.cmd run release:win:build
if ($LASTEXITCODE -ne 0) {
  throw "Windows release build failed."
}

if (-not (Test-Path -LiteralPath $portableSource)) {
  throw "Portable executable was not found: $portableSource"
}

$setupSource = Get-ChildItem -LiteralPath $nsisDir -Filter "*.exe" -Recurse |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $setupSource) {
  throw "NSIS setup executable was not found: $nsisDir"
}

Remove-Item -LiteralPath $assetDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $assetDir | Out-Null

Copy-Item -LiteralPath $portableSource -Destination $portableAsset -Force
Copy-Item -LiteralPath $setupSource.FullName -Destination $setupAsset -Force

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) is required to upload releases. Install it and run 'gh auth login'."
}

$repo = (& gh repo view --json nameWithOwner --jq ".nameWithOwner").Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repo)) {
  throw "Failed to resolve GitHub repository with gh."
}

Write-Host "Preparing GitHub Release $Tag..."
& gh release view $Tag *> $null

if ($LASTEXITCODE -ne 0) {
  & gh release create $Tag --title "ShellPilot $Tag" --notes "ShellPilot $Tag release"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create GitHub Release $Tag."
  }
}

Write-Host "Uploading release assets..."
& gh release upload $Tag $setupAsset $portableAsset --clobber
if ($LASTEXITCODE -ne 0) {
  throw "Failed to upload release assets."
}

Write-Host "Uploaded:"
Write-Host "  $setupAsset"
Write-Host "  $portableAsset"
