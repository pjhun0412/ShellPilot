#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
TAG="${1:-v$VERSION}"
HOST_TARGET="$(rustc -vV | awk '/host:/ { print $2 }')"
SIDECAR_MANIFEST="$ROOT/src-tauri/rdp-sidecar/Cargo.toml"
SIDECAR_SOURCE="$ROOT/src-tauri/rdp-sidecar/target/release/shellpilot-rdp-probe"
SIDECAR_EXTERNAL_BIN_DIR="$ROOT/src-tauri/binaries"
SIDECAR_EXTERNAL_BIN="$SIDECAR_EXTERNAL_BIN_DIR/shellpilot-rdp-probe-$HOST_TARGET"
ASSET_DIR="$ROOT/release-assets"
APP_BUNDLE="$ROOT/src-tauri/target/release/bundle/macos/ShellPilot.app"
APP_ZIP="$ASSET_DIR/ShellPilot-$VERSION-macos-$HOST_TARGET-app.zip"

echo "Building ShellPilot RDP sidecar $VERSION for $HOST_TARGET..."
cargo build --release --manifest-path "$SIDECAR_MANIFEST"

if [[ ! -f "$SIDECAR_SOURCE" ]]; then
  echo "RDP sidecar executable was not found: $SIDECAR_SOURCE" >&2
  exit 1
fi

mkdir -p "$SIDECAR_EXTERNAL_BIN_DIR"
cp "$SIDECAR_SOURCE" "$SIDECAR_EXTERNAL_BIN"

echo "Building ShellPilot $VERSION macOS .app bundle for $HOST_TARGET..."
npm run tauri -- build --bundles app

if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "ShellPilot.app was not produced: $APP_BUNDLE" >&2
  exit 1
fi

mkdir -p "$ASSET_DIR"
rm -f "$APP_ZIP"
echo "Packaging ShellPilot.app zip..."
(
  cd "$(dirname "$APP_BUNDLE")"
  ditto -c -k --sequesterRsrc --keepParent "$(basename "$APP_BUNDLE")" "$APP_ZIP"
)

echo "Attempting ShellPilot $VERSION macOS DMG bundle for $HOST_TARGET..."
if npm run tauri -- build --bundles dmg; then
  echo "Built macOS DMG for $TAG."
else
  echo "macOS DMG bundling failed; keeping .app zip for testing: $APP_ZIP" >&2
fi

echo "Built macOS app bundle for $TAG."
echo "App zip: $APP_ZIP"
echo "Note: upload/signing and updater latest.json platform entries are still release-process work."
