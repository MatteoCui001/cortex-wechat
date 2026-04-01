#!/usr/bin/env bash
# Cortex updater — pull latest code, update deps, run migrations.
set -euo pipefail

CORTEX_DIR="$HOME/Projects/cortex"
WECHAT_DIR="$HOME/Projects/cortex-wechat"
ENV_FILE="$HOME/.cortex/env"

RED='\033[0;31m'; GREEN='\033[0;32m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

echo -e "${BOLD}Cortex Update${NC}"
echo ""

# Pull backend
if [ -d "$CORTEX_DIR/.git" ]; then
  echo "Updating backend..."
  (cd "$CORTEX_DIR" && git pull --ff-only 2>&1 | tail -3)
  ok "Backend pulled"

  # Update Python deps
  (cd "$CORTEX_DIR" && uv sync --python 3.12 --extra local-embeddings 2>&1 | tail -3)
  ok "Python deps updated"

  # Run migrations
  MIGRATION_COUNT=0
  for f in "$CORTEX_DIR/migrations"/0*.sql; do
    [ -f "$f" ] || continue
    if psql -d cortex -v ON_ERROR_STOP=0 -f "$f" >/dev/null 2>&1; then
      MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
    fi
  done
  ok "$MIGRATION_COUNT migrations processed"

  # Rebuild console if present
  CONSOLE_DIR="$CORTEX_DIR/console"
  if [ -f "$CONSOLE_DIR/package.json" ]; then
    echo "Rebuilding console..."
    if command -v npm &>/dev/null; then
      (cd "$CONSOLE_DIR" && npm ci --ignore-scripts 2>&1 | tail -3 && npm run build 2>&1 | tail -3)
    elif command -v bun &>/dev/null; then
      (cd "$CONSOLE_DIR" && bun install 2>&1 | tail -3 && bun run build 2>&1 | tail -3)
    fi
    ok "Console rebuilt"
  fi
else
  fail "Backend not found at $CORTEX_DIR"
fi

# Pull WeChat agent
if [ -d "$WECHAT_DIR/.git" ]; then
  echo "Updating WeChat agent..."
  (cd "$WECHAT_DIR" && git pull --ff-only 2>&1 | tail -3)
  ok "WeChat agent pulled"

  (cd "$WECHAT_DIR" && bun install 2>&1 | tail -3)
  ok "Bun deps updated"
else
  fail "WeChat agent not found at $WECHAT_DIR"
fi

echo ""
echo -e "${GREEN}${BOLD}Update complete!${NC}"
echo "Run: cortex restart"
