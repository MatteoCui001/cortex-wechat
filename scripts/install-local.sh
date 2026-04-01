#!/usr/bin/env bash
# Cortex Local Installer — macOS single-user public release
# Usage: ./scripts/install-local.sh
#
# Idempotent: safe to re-run. Existing data/config is preserved.
set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CORTEX_REPO="https://github.com/MatteoCui001/cortex.git"
CORTEX_DIR="$HOME/Projects/cortex"
# cortex-wechat is THIS repo (the one containing this script)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WECHAT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$CORTEX_DIR/migrations"
ENV_FILE="$HOME/.cortex/env"
DB_NAME="cortex"

# Ensure common tool paths are on PATH (bun, uv may live in user-local dirs)
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

step()  { echo -e "\n${BOLD}[$1/8]${NC} $2"; }
ok()    { echo -e "  ${GREEN}OK${NC} $1"; }
warn()  { echo -e "  ${YELLOW}WARN${NC} $1"; }
fail()  { echo -e "  ${RED}FAIL${NC} $1"; exit 1; }
skip()  { echo -e "  ${GREEN}SKIP${NC} $1 (already done)"; }

check_cmd() {
  if command -v "$1" &>/dev/null; then
    ok "$1 found: $(command -v "$1")"
    return 0
  else
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Step 1: Check environment
# ---------------------------------------------------------------------------
step 1 "Checking environment..."

[[ "$(uname)" == "Darwin" ]] || fail "This installer only supports macOS."
ok "macOS $(sw_vers -productVersion)"

check_cmd git || fail "git not found. Install Xcode CLT: xcode-select --install"
check_cmd psql || fail "psql not found. Install: brew install postgresql@16"
check_cmd uv   || fail "uv not found. Install: brew install uv"
check_cmd bun  || fail "bun not found. Install: brew install oven-sh/bun/bun"

# Check PostgreSQL is running
if pg_isready -q 2>/dev/null; then
  ok "PostgreSQL is running"
else
  fail "PostgreSQL is not running. Start it: brew services start postgresql@16"
fi

# ---------------------------------------------------------------------------
# Step 2: Check or clone repos
# ---------------------------------------------------------------------------
step 2 "Checking repositories..."

if [ -d "$CORTEX_DIR/.git" ]; then
  skip "cortex repo exists at $CORTEX_DIR"
  # Pull latest
  echo "  Pulling latest..."
  (cd "$CORTEX_DIR" && git pull --ff-only 2>/dev/null) || warn "git pull failed (non-critical, using existing code)"
else
  echo "  Cloning cortex to $CORTEX_DIR..."
  mkdir -p "$(dirname "$CORTEX_DIR")"
  git clone "$CORTEX_REPO" "$CORTEX_DIR"
  ok "Cloned cortex"
fi

# cortex-wechat is already here (user ran this script from it)
ok "cortex-wechat at $WECHAT_DIR"

# ---------------------------------------------------------------------------
# Step 3: Install backend dependencies
# ---------------------------------------------------------------------------
step 3 "Installing backend dependencies (uv sync)..."

(cd "$CORTEX_DIR" && uv sync 2>&1 | tail -3)
ok "Backend dependencies installed"

# ---------------------------------------------------------------------------
# Step 4: Initialize database
# ---------------------------------------------------------------------------
step 4 "Initializing database..."

# Create DB if not exists
if psql -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
  skip "Database '$DB_NAME' already exists"
else
  echo "  Creating database '$DB_NAME'..."
  createdb "$DB_NAME"
  ok "Database created"
fi

# Run migrations (idempotent — each migration uses IF NOT EXISTS or similar)
echo "  Running migrations..."
MIGRATION_COUNT=0
for f in "$MIGRATIONS_DIR"/0*.sql; do
  [ -f "$f" ] || continue
  if psql -d "$DB_NAME" -f "$f" >/dev/null 2>&1; then
    MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
  else
    warn "Migration $(basename "$f") had issues (may already be applied)"
  fi
done
ok "$MIGRATION_COUNT migration files processed"

# ---------------------------------------------------------------------------
# Step 5: Install frontend/agent dependencies
# ---------------------------------------------------------------------------
step 5 "Installing frontend dependencies (bun install)..."

(cd "$WECHAT_DIR" && bun install 2>&1 | tail -3)
ok "Frontend dependencies installed"

# ---------------------------------------------------------------------------
# Step 6: Write config / env
# ---------------------------------------------------------------------------
step 6 "Configuring environment..."

mkdir -p "$HOME/.cortex"

# Generate a random API token if not already set
_generate_token() {
  # 32-byte random hex — simple and secure
  openssl rand -hex 32 2>/dev/null || LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 64
}

# Create env file if not exists; merge missing keys if it does
if [ -f "$ENV_FILE" ]; then
  skip "Env file exists at $ENV_FILE"
  # Check for missing keys and append them
  for key in LLM_BASE_URL LLM_API_KEY LLM_MODEL CORTEX_API_TOKEN; do
    if ! grep -q "^export $key=" "$ENV_FILE" 2>/dev/null; then
      case $key in
        LLM_BASE_URL)     echo "export LLM_BASE_URL=\"https://api.minimaxi.chat/v1\"" >> "$ENV_FILE" ;;
        LLM_API_KEY)      echo "export LLM_API_KEY=\"\"  # fill in your MiniMax API key" >> "$ENV_FILE" ;;
        LLM_MODEL)        echo "export LLM_MODEL=\"MiniMax-M2.7\"" >> "$ENV_FILE" ;;
        CORTEX_API_TOKEN) echo "export CORTEX_API_TOKEN=\"$(_generate_token)\"" >> "$ENV_FILE" ;;
      esac
      warn "Added missing $key to $ENV_FILE"
    fi
  done
else
  GENERATED_TOKEN="$(_generate_token)"
  cat > "$ENV_FILE" << ENVEOF
# Cortex Environment Configuration
# Sourced by both cortex-serve and ilink-agent at startup.

# API Authentication — auto-generated, shared between cortex and ilink-agent.
# Both services read this token; no manual setup needed.
export CORTEX_API_TOKEN="$GENERATED_TOKEN"

# LLM Configuration
# Used for signal detection and semantic routing.
# Leave LLM_API_KEY empty to run in regex-only mode (no signal detection).
export LLM_BASE_URL="https://api.minimaxi.chat/v1"
export LLM_API_KEY=""
export LLM_MODEL="MiniMax-M2.7"
ENVEOF
  chmod 600 "$ENV_FILE"
  ok "Generated API token and config at $ENV_FILE"
  warn "Edit $ENV_FILE to add your LLM_API_KEY for signal detection"
fi

# Generate wrapper scripts from templates (user-specific paths)
_generate_wrappers() {
  local UV_PATH BUN_PATH
  UV_PATH="$(command -v uv)"
  BUN_PATH="$(command -v bun)"
  local BUN_DIR
  BUN_DIR="$(dirname "$BUN_PATH")"

  # cortex-serve.sh
  cat > "$WECHAT_DIR/scripts/launchd/cortex-serve.sh" << EOF
#!/usr/bin/env bash
# Auto-generated by install-local.sh — do not edit manually.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="$HOME"

# Source shared env (API token, LLM config)
[ -f "$HOME/.cortex/env" ] && source "$HOME/.cortex/env"
export CORTEX_API_TOKEN="\${CORTEX_API_TOKEN:-}"
export LLM_API_KEY="\${LLM_API_KEY:-}"

cd "$CORTEX_DIR" || exit 1
exec "$UV_PATH" run cortex serve
EOF
  chmod +x "$WECHAT_DIR/scripts/launchd/cortex-serve.sh"

  # ilink-agent.sh
  cat > "$WECHAT_DIR/scripts/launchd/ilink-agent.sh" << EOF
#!/usr/bin/env bash
# Auto-generated by install-local.sh — do not edit manually.
export PATH="$BUN_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="$HOME"

# Source shared env (API token, LLM config)
[ -f "$HOME/.cortex/env" ] && source "$HOME/.cortex/env"
export CORTEX_API_TOKEN="\${CORTEX_API_TOKEN:-}"

cd "$WECHAT_DIR" || exit 1
exec "$BUN_PATH" run start:ilink
EOF
  chmod +x "$WECHAT_DIR/scripts/launchd/ilink-agent.sh"

  # Plist files (replace hardcoded paths)
  local LOG_CORTEX="$HOME/Library/Logs/cortex"
  local LOG_ILINK="$HOME/Library/Logs/cortex-wechat"

  cat > "$WECHAT_DIR/scripts/launchd/com.cortex.serve.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cortex.serve</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$WECHAT_DIR/scripts/launchd/cortex-serve.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_CORTEX/serve.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_CORTEX/serve.err</string>
</dict>
</plist>
EOF

  cat > "$WECHAT_DIR/scripts/launchd/com.cortex.ilink-agent.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cortex.ilink-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$WECHAT_DIR/scripts/launchd/ilink-agent.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_ILINK/ilink-agent.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_ILINK/ilink-agent.err</string>
</dict>
</plist>
EOF

  cat > "$WECHAT_DIR/scripts/launchd/com.cortex.digest-cron.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cortex.digest-cron</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>source ~/.cortex/env &amp;&amp; curl -sf -X POST -H "Authorization: Bearer \$CORTEX_API_TOKEN" http://127.0.0.1:8420/api/v1/digest/push?days=1 || true</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>8</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_CORTEX/digest-cron.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_CORTEX/digest-cron.err</string>
</dict>
</plist>
EOF
}

_generate_wrappers
ok "Generated wrapper scripts and plists for $USER"

# ---------------------------------------------------------------------------
# Step 7: Install and start launchd services
# ---------------------------------------------------------------------------
step 7 "Installing and starting services..."

"$WECHAT_DIR/scripts/cortex-services.sh" install
"$WECHAT_DIR/scripts/cortex-services.sh" start

# ---------------------------------------------------------------------------
# Step 8: Final verification
# ---------------------------------------------------------------------------
step 8 "Verifying installation..."

# Health check with retry
HEALTH_OK=false
for i in 1 2 3 4 5; do
  if curl -sf http://127.0.0.1:8420/api/v1/health >/dev/null 2>&1; then
    HEALTH_OK=true
    break
  fi
  sleep 2
done

if $HEALTH_OK; then
  ok "Cortex API is healthy"
else
  warn "Cortex API not responding yet (may still be starting — check logs)"
fi

# Check LLM config
if [ -f "$ENV_FILE" ] && grep -q 'LLM_API_KEY=""' "$ENV_FILE"; then
  warn "LLM_API_KEY is empty — signal detection disabled (regex-only mode)"
  echo "  To enable: edit $ENV_FILE and restart services"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}Installation complete!${NC}"
echo ""
echo "  Console:     http://127.0.0.1:8420/console"
echo "  Health:      curl http://127.0.0.1:8420/api/v1/health"
echo ""
echo "  Service management:"
echo "    $WECHAT_DIR/scripts/cortex-services.sh status"
echo "    $WECHAT_DIR/scripts/cortex-services.sh restart"
echo "    $WECHAT_DIR/scripts/cortex-services.sh logs"
echo ""
echo "  LLM config:  $ENV_FILE"
echo ""
echo -e "${BOLD}Next step:${NC} Scan WeChat QR code to connect"
echo "  Run in foreground first time:  cd $WECHAT_DIR && bun run start:ilink"
echo "  (Ctrl+C after scanning, then restart the service)"
echo ""
