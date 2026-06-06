#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────
# Build script for the agi standalone binary
# Requires: bun
#
# Usage:
#   ./scripts/build.sh                    # builds for current platform
#   ./scripts/build.sh linux-x64          # cross-compile (via docker)
#   ./scripts/build.sh linux-arm64
#   ./scripts/build.sh darwin-x64
#   ./scripts/build.sh darwin-arm64
# ─────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

TARGET="${1:-native}"
OUTFILE="agi-${TARGET}"

echo "=== Building agi for target: $TARGET ==="

bun install --frozen-lockfile 2>/dev/null || bun install

case "$TARGET" in
  native)
    bun build --compile ./src/cli.ts --outfile "$OUTFILE"
    ;;
  linux-x64)
    # Requires docker with node+bun
    docker run --rm -v "$(pwd):/app" -w /app oven/bun:latest \
      sh -c "bun install && bun build --compile ./src/cli.ts --outfile agi-linux-x64"
    OUTFILE="agi-linux-x64"
    ;;
  linux-arm64)
    docker run --rm -v "$(pwd):/app" -w /app --platform=linux/arm64 oven/bun:latest \
      sh -c "bun install && bun build --compile ./src/cli.ts --outfile agi-linux-arm64"
    OUTFILE="agi-linux-arm64"
    ;;
  darwin-x64)
    echo "⚠️  Cross-compile for darwin-x64 requires running on an Intel Mac."
    echo "   Clone the repo, run 'bun install && bun build --compile ./src/cli.ts' there."
    exit 1
    ;;
  darwin-arm64)
    echo "ℹ️  Already on darwin-arm64 — running native build."
    bun build --compile ./src/cli.ts --outfile "$OUTFILE"
    ;;
  *)
    echo "Unknown target: $TARGET"
    echo "Usage: $0 [native|linux-x64|linux-arm64|darwin-x64|darwin-arm64]"
    exit 1
    ;;
esac

echo ""
echo "✅ Built: ${OUTFILE}"
ls -lh "${OUTFILE}" || ls -lh "agi-${TARGET}"

# macOS: ad-hoc sign so AMFI doesn't kill the binary when copied/moved
if [[ "$(uname)" == "Darwin" ]] && [[ "$TARGET" == "native" || "$TARGET" == darwin-* ]]; then
	codesign --force --sign - "$OUTFILE" 2>/dev/null && echo "🔏 Signed ${OUTFILE}" || echo "⚠️  codesign failed (non-fatal)"
fi
