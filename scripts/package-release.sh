#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────
# Package a deployable release of the agi binary.
#
# Produces: dist/agi-<version>-<target>.tar.gz
#
# Usage:
#   ./scripts/package-release.sh                # builds + packages for current platform
#   ./scripts/package-release.sh <target>       # builds + packages for given target
#   ./scripts/package-release.sh native --skip-build  # package existing binary
# ─────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"
VERSION="$(node -p "require('./package.json').version || '1.0.0'")"
TARGET="${1:-native}"

# ── Build if needed ──
if [ "${2:-}" != "--skip-build" ]; then
  "$SCRIPT_DIR/build.sh" "$TARGET"
fi

case "$TARGET" in
  native)  OUTFILE="agi-${TARGET}";;
  *)       OUTFILE="agi-${TARGET}";;
esac

# Find the binary — could be "agi", "agi-native", "agi-<target>", etc.
if [ ! -f "$OUTFILE" ]; then
  # shellcheck disable=SC2012
  FOUND=$(ls agi 2>/dev/null || true)
  if [ -z "$FOUND" ]; then
    FOUND=$(find . -maxdepth 1 -name 'agi*' -type f 2>/dev/null | head -1)
  fi
  OUTFILE="${FOUND:-}"
fi
if [ -z "$OUTFILE" ] || [ ! -f "$OUTFILE" ]; then
  echo "❌ No binary found. Run build.sh first."
  exit 1
fi

# ── Create package directory ──
PKG_NAME="agi-${VERSION}-${TARGET}"
PKG_DIR="dist/${PKG_NAME}"
mkdir -p "$PKG_DIR"

# Copy binary
cp "$OUTFILE" "${PKG_DIR}/agi"
chmod +x "${PKG_DIR}/agi"

# ── Create default config template ──
cat > "${PKG_DIR}/.agi.env" << 'ENVEOF'
# ── agi ─────────────────────────────────────────
# Copy this file to ~/.agi/.env or the project
# directory's .env file. Edit the values below.
# ────────────────────────────────────────────────

# === REQUIRED (at least one of these) ===
# DeepSeek API key (if using deepseek provider)
# DEEPSEEK_API_KEY=sk-your-key-here

# LM Studio is local — no API key needed by default
# LMSTUDIO_URL=http://localhost:1234/v1

# === OPTIONAL ===
# Override the default model and provider
# AGENT_MODEL=deepseek-chat
# PROVIDER=deepseek
# AGI_MODE=safe
# AGI_MARKDOWN=true

# Web search (pick one backend)
# SEARCH_BACKEND=google
# GOOGLE_API_KEY=your-google-api-key
# GOOGLE_CSE_ID=your-cse-id
# SERPER_API_KEY=your-serper-api-key

# Observability (optional)
# LMNR_PROJECT_API_KEY=your-laminar-key
ENVEOF

# ── Create default config file ──
cat > "${PKG_DIR}/.agirc.json" << 'JSONEOF'
{
  "defaultModel": "deepseek-v4-pro",
  "defaultProvider": "deepseek",
  "mode": "safe",
  "markdown": true,
  "lmstudioUrl": "http://localhost:1234/v1",
  "mcpServers": []
}
JSONEOF

# ── Create setup/readme ──
cat > "${PKG_DIR}/SETUP.md" << 'MDEOF'
# agi — Setup Guide

## Quick Start

1. **Place the binary** somewhere in your PATH:
   ```
   mv agi /usr/local/bin/agi
   chmod +x /usr/local/bin/agi
   ```

2. **Set up your config directory:**
   ```
   mkdir -p ~/.agi
   ```

3. **Copy and edit the config files:**
   ```
   cp .agi.env ~/.agi/.env
   cp .agirc.json ~/.agi/   # optional, uses defaults
   ```

4. **Edit `~/.agi/.env`** and add at least one API key.

5. **Run it:**
   ```
   agi
   ```

## Configuration

- `~/.agi/.env` — Environment variables (API keys, model overrides)
- `~/.agirc.json` — JSON config file
- `.env` in the current directory also works (project-specific overrides)

The binary loads config in this order (later overrides earlier):
1. Bundled defaults
2. `~/.agi/.env`
3. `./.env` (project directory)
4. Environment variables

## Requirements

**None.** The binary is fully self-contained — no Node.js, Bun, or npm needed.

## Running with a local model (LM Studio)

1. Start LM Studio, load a model, and start the local server (default: port 1234)
2. Set `PROVIDER=lmstudio` and `AGENT_MODEL=<model-name>` in `~/.agi/.env`
3. Run `agi`

## MCP Servers

To add MCP tools, add them to `~/.agirc.json` under `"mcpServers"`.

Example:
```json
{
  "mcpServers": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]
    }
  ]
}
```
MDEOF

# ── Create archive ──
cd dist
tar czf "${PKG_NAME}.tar.gz" "${PKG_NAME}"
echo ""
echo "✅ Release packaged: dist/${PKG_NAME}.tar.gz"
echo "   Size: $(ls -lh "${PKG_NAME}.tar.gz" | awk '{print $5}')"
echo ""
echo "Contents:"
tar tzf "${PKG_NAME}.tar.gz"
