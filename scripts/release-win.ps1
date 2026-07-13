param(
  [string]$Tag
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$package = Get-Content -LiteralPath "package.json" | ConvertFrom-Json
$version = $package.version

if ([string]::IsNullOrWhiteSpace($Tag)) {
  $Tag = "v$version"
}

$assetDir = Join-Path $root "release-assets"
$portableSource = Join-Path $root "src-tauri\target\release\ShellPilot.exe"
$rdpSidecarManifest = Join-Path $root "src-tauri\rdp-sidecar\Cargo.toml"
$rdpSidecarSource = Join-Path $root "src-tauri\rdp-sidecar\target\release\shellpilot-rdp-probe.exe"
$vncSidecarManifest = Join-Path $root "src-tauri\vnc-sidecar\Cargo.toml"
$vncSidecarSource = Join-Path $root "src-tauri\vnc-sidecar\target\release\shellpilot-vnc-probe.exe"
$sidecarExternalBinDir = Join-Path $root "src-tauri\binaries"
$rdpSidecarExternalBin = Join-Path $sidecarExternalBinDir "shellpilot-rdp-probe-x86_64-pc-windows-msvc.exe"
$vncSidecarExternalBin = Join-Path $sidecarExternalBinDir "shellpilot-vnc-probe-x86_64-pc-windows-msvc.exe"
$nsisDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
$portableStagingDir = Join-Path $assetDir "ShellPilot-$version-portable"
$portableAsset = Join-Path $assetDir "ShellPilot-$version-portable.zip"
$setupAsset = Join-Path $assetDir "ShellPilot-$version-setup.exe"
$setupSignatureAsset = "$setupAsset.sig"
$latestJsonAsset = Join-Path $assetDir "latest.json"

Write-Host "Building ShellPilot RDP sidecar $version..."
cargo.exe build --release --manifest-path $rdpSidecarManifest
if ($LASTEXITCODE -ne 0) {
  throw "RDP sidecar release build failed."
}

if (-not (Test-Path -LiteralPath $rdpSidecarSource)) {
  throw "RDP sidecar executable was not found: $rdpSidecarSource"
}

Write-Host "Building ShellPilot VNC sidecar $version..."
cargo.exe build --release --manifest-path $vncSidecarManifest
if ($LASTEXITCODE -ne 0) {
  throw "VNC sidecar release build failed."
}

if (-not (Test-Path -LiteralPath $vncSidecarSource)) {
  throw "VNC sidecar executable was not found: $vncSidecarSource"
}

New-Item -ItemType Directory -Force -Path $sidecarExternalBinDir | Out-Null
Copy-Item -LiteralPath $rdpSidecarSource -Destination $rdpSidecarExternalBin -Force
Copy-Item -LiteralPath $vncSidecarSource -Destination $vncSidecarExternalBin -Force

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

New-Item -ItemType Directory -Force -Path $portableStagingDir | Out-Null
Copy-Item -LiteralPath $portableSource -Destination (Join-Path $portableStagingDir "ShellPilot.exe") -Force
Copy-Item -LiteralPath $rdpSidecarSource -Destination (Join-Path $portableStagingDir "shellpilot-rdp-probe.exe") -Force
Copy-Item -LiteralPath $vncSidecarSource -Destination (Join-Path $portableStagingDir "shellpilot-vnc-probe.exe") -Force
Compress-Archive -Path (Join-Path $portableStagingDir "*") -DestinationPath $portableAsset -Force
Copy-Item -LiteralPath $setupSource.FullName -Destination $setupAsset -Force

$setupSignatureSource = "$($setupSource.FullName).sig"
if (-not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PATH) -or
    -not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
  Write-Host "Signing setup executable for updater..."
  Remove-Item -LiteralPath $setupSignatureSource -Force -ErrorAction SilentlyContinue
  if (-not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PATH)) {
    $signOutput = npm.cmd run --silent tauri -- signer sign --private-key-path $env:TAURI_SIGNING_PRIVATE_KEY_PATH $setupSource.FullName
  } else {
    $signOutput = npm.cmd run --silent tauri -- signer sign --private-key $env:TAURI_SIGNING_PRIVATE_KEY $setupSource.FullName
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to sign updater package. Set TAURI_SIGNING_PRIVATE_KEY_PATH or TAURI_SIGNING_PRIVATE_KEY."
  }

  if (-not (Test-Path -LiteralPath $setupSignatureSource)) {
    $signature = $signOutput |
      ForEach-Object { "$_".Trim() } |
      Where-Object { $_ -match "^[A-Za-z0-9+/=]+$" -and $_.Length -gt 100 } |
      Select-Object -Last 1

    if (-not [string]::IsNullOrWhiteSpace($signature)) {
      Set-Content -LiteralPath $setupSignatureSource -Value $signature -Encoding UTF8
    }
  }
}

if (-not (Test-Path -LiteralPath $setupSignatureSource)) {
  throw "Updater signature was not found after signing: $setupSignatureSource"
}

Copy-Item -LiteralPath $setupSignatureSource -Destination $setupSignatureAsset -Force

$ghCommand = Get-Command gh -ErrorAction SilentlyContinue
if (-not $ghCommand) {
  $commonGhPath = Join-Path $env:ProgramFiles "GitHub CLI\gh.exe"
  if (Test-Path -LiteralPath $commonGhPath) {
    $ghCommand = Get-Item -LiteralPath $commonGhPath
  }
}

if (-not $ghCommand) {
  throw "GitHub CLI (gh) is required to upload releases. Install it and run 'gh auth login'."
}

$gh = $ghCommand.Source
if ([string]::IsNullOrWhiteSpace($gh)) {
  $gh = $ghCommand.FullName
}

$repo = (& $gh repo view --json nameWithOwner --jq ".nameWithOwner").Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repo)) {
  throw "Failed to resolve GitHub repository with gh."
}

Write-Host "Preparing GitHub Release $Tag..."
& $gh release view $Tag *> $null

if ($LASTEXITCODE -ne 0) {
  & $gh release create $Tag --title "ShellPilot $Tag" --notes "ShellPilot $Tag release"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create GitHub Release $Tag."
  }
}

$setupUrl = "https://github.com/$repo/releases/download/$Tag/ShellPilot-$version-setup.exe"
$signature = (Get-Content -Raw -LiteralPath $setupSignatureAsset).Trim()
$publishedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$latestJson = [ordered]@{
  version = $version
  notes = "ShellPilot $Tag release"
  pub_date = $publishedAt
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $signature
      url = $setupUrl
    }
  }
} | ConvertTo-Json -Depth 6

Set-Content -LiteralPath $latestJsonAsset -Value $latestJson -Encoding UTF8

Write-Host "Uploading release assets..."
& $gh release upload $Tag $setupAsset $setupSignatureAsset $portableAsset $latestJsonAsset --clobber
if ($LASTEXITCODE -ne 0) {
  throw "Failed to upload release assets."
}

Write-Host "Uploaded:"
Write-Host "  $setupAsset"
Write-Host "  $setupSignatureAsset"
Write-Host "  $portableAsset"
Write-Host "  $latestJsonAsset"
