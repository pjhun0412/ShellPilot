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

echo "Building ShellPilot RDP sidecar $VERSION for $HOST_TARGET..."
cargo build --release --manifest-path "$SIDECAR_MANIFEST"

if [[ ! -f "$SIDECAR_SOURCE" ]]; then
  echo "RDP sidecar executable was not found: $SIDECAR_SOURCE" >&2
  exit 1
fi

mkdir -p "$SIDECAR_EXTERNAL_BIN_DIR"
cp "$SIDECAR_SOURCE" "$SIDECAR_EXTERNAL_BIN"

echo "Building ShellPilot $VERSION macOS bundle for $HOST_TARGET..."
npm run tauri -- build --bundles app,dmg

echo "Built macOS bundle for $TAG."
echo "Note: upload/signing and updater latest.json platform entries are still release-process work."
