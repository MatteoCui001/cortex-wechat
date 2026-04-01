#!/usr/bin/env bash
# Cortex services manager — install, start, stop, status, logs for launchd.
# Usage: ./scripts/cortex-services.sh <command>
#   install   — install launchd plists and create log directories
#   uninstall — unload and remove launchd plists
#   start     — load all services
#   stop      — unload all services
#   restart   — stop then start
#   status    — show service status
#   logs      — tail all service logs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_DIR="$SCRIPT_DIR/launchd"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"

CORTEX_LABEL="com.cortex.serve"
ILINK_LABEL="com.cortex.ilink-agent"
DIGEST_LABEL="com.cortex.digest-cron"
CORTEX_PLIST="$PLIST_DIR/$CORTEX_LABEL.plist"
ILINK_PLIST="$PLIST_DIR/$ILINK_LABEL.plist"
DIGEST_PLIST="$PLIST_DIR/$DIGEST_LABEL.plist"

CORTEX_LOG_DIR="$HOME/Library/Logs/cortex"
ILINK_LOG_DIR="$HOME/Library/Logs/cortex-wechat"

require_generated_assets() {
  local missing=0
  local required=(
    "$PLIST_DIR/cortex-serve.sh"
    "$PLIST_DIR/ilink-agent.sh"
    "$CORTEX_PLIST"
    "$ILINK_PLIST"
    "$DIGEST_PLIST"
  )

  for file in "${required[@]}"; do
    if [ ! -f "$file" ]; then
      echo "Missing generated launchd asset: $file" >&2
      missing=1
    fi
  done

  if [ "$missing" -ne 0 ]; then
    echo "Run './scripts/install-local.sh' first to regenerate launchd assets." >&2
    exit 1
  fi
}

ensure_log_dirs() {
  mkdir -p "$CORTEX_LOG_DIR" "$ILINK_LOG_DIR"
}

cmd_install() {
  require_generated_assets
  ensure_log_dirs
  mkdir -p "$LAUNCH_AGENTS"
  cp "$CORTEX_PLIST" "$LAUNCH_AGENTS/$CORTEX_LABEL.plist"
  cp "$ILINK_PLIST" "$LAUNCH_AGENTS/$ILINK_LABEL.plist"
  cp "$DIGEST_PLIST" "$LAUNCH_AGENTS/$DIGEST_LABEL.plist"
  echo "Installed:"
  echo "  $LAUNCH_AGENTS/$CORTEX_LABEL.plist"
  echo "  $LAUNCH_AGENTS/$ILINK_LABEL.plist"
  echo "  $LAUNCH_AGENTS/$DIGEST_LABEL.plist"
  echo ""
  echo "Run './scripts/cortex-services.sh start' to load services."
}

cmd_uninstall() {
  launchctl unload "$LAUNCH_AGENTS/$CORTEX_LABEL.plist" 2>/dev/null || true
  launchctl unload "$LAUNCH_AGENTS/$ILINK_LABEL.plist" 2>/dev/null || true
  launchctl unload "$LAUNCH_AGENTS/$DIGEST_LABEL.plist" 2>/dev/null || true
  rm -f "$LAUNCH_AGENTS/$CORTEX_LABEL.plist"
  rm -f "$LAUNCH_AGENTS/$ILINK_LABEL.plist"
  rm -f "$LAUNCH_AGENTS/$DIGEST_LABEL.plist"
  echo "Uninstalled all services."
}

cmd_start() {
  require_generated_assets
  ensure_log_dirs
  local uid
  uid=$(id -u)
  # Load plists (registers with launchd)
  launchctl load "$LAUNCH_AGENTS/$CORTEX_LABEL.plist" 2>/dev/null || true
  # Kickstart forces immediate process spawn
  launchctl kickstart "gui/$uid/$CORTEX_LABEL" 2>/dev/null || true
  echo "Started $CORTEX_LABEL"
  sleep 3
  launchctl load "$LAUNCH_AGENTS/$ILINK_LABEL.plist" 2>/dev/null || true
  launchctl kickstart "gui/$uid/$ILINK_LABEL" 2>/dev/null || true
  echo "Started $ILINK_LABEL"
  # digest-cron is calendar-based; load registers it with launchd (no kickstart needed)
  launchctl load "$LAUNCH_AGENTS/$DIGEST_LABEL.plist" 2>/dev/null || true
  echo "Loaded $DIGEST_LABEL (fires daily at 08:00)"
  echo ""
  cmd_status
}

cmd_stop() {
  local uid
  uid=$(id -u)
  # Kill processes first, then unload
  launchctl kill SIGTERM "gui/$uid/$ILINK_LABEL" 2>/dev/null || true
  launchctl unload "$LAUNCH_AGENTS/$ILINK_LABEL.plist" 2>/dev/null || true
  echo "Stopped $ILINK_LABEL"
  launchctl kill SIGTERM "gui/$uid/$CORTEX_LABEL" 2>/dev/null || true
  launchctl unload "$LAUNCH_AGENTS/$CORTEX_LABEL.plist" 2>/dev/null || true
  echo "Stopped $CORTEX_LABEL"
  launchctl unload "$LAUNCH_AGENTS/$DIGEST_LABEL.plist" 2>/dev/null || true
  echo "Unloaded $DIGEST_LABEL"
}

cmd_restart() {
  cmd_stop
  sleep 2
  cmd_start
}

cmd_status() {
  echo "=== Cortex Services Status ==="
  echo ""

  # Cortex
  local cortex_line
  cortex_line=$(launchctl list 2>/dev/null | grep "$CORTEX_LABEL" || true)
  if [ -n "$cortex_line" ]; then
    local pid
    pid=$(echo "$cortex_line" | awk '{print $1}')
    if [ "$pid" = "-" ]; then
      echo "  [LOADED]  $CORTEX_LABEL (not running)"
    else
      echo "  [RUNNING] $CORTEX_LABEL (pid: $pid)"
    fi
  else
    echo "  [STOPPED] $CORTEX_LABEL"
  fi

  # Health check
  if curl -sf http://127.0.0.1:8420/api/v1/health >/dev/null 2>&1; then
    echo "           Cortex API: reachable"
  else
    echo "           Cortex API: unreachable"
  fi

  echo ""

  # ilink-agent
  local ilink_line
  ilink_line=$(launchctl list 2>/dev/null | grep "$ILINK_LABEL" || true)
  if [ -n "$ilink_line" ]; then
    local pid2
    pid2=$(echo "$ilink_line" | awk '{print $1}')
    if [ "$pid2" = "-" ]; then
      echo "  [LOADED]  $ILINK_LABEL (not running)"
    else
      echo "  [RUNNING] $ILINK_LABEL (pid: $pid2)"
    fi
  else
    echo "  [STOPPED] $ILINK_LABEL"
  fi

  # ilink last log line
  local ilink_log="$ILINK_LOG_DIR/ilink-agent.log"
  if [ -f "$ilink_log" ]; then
    echo "           Last log: $(tail -1 "$ilink_log")"
  fi

  # digest-cron
  local digest_line
  digest_line=$(launchctl list 2>/dev/null | grep "$DIGEST_LABEL" || true)
  if [ -n "$digest_line" ]; then
    echo "  [LOADED]  $DIGEST_LABEL (fires daily at 08:00)"
  else
    echo "  [STOPPED] $DIGEST_LABEL"
  fi

  echo ""
  echo "Logs:"
  echo "  Cortex:       $CORTEX_LOG_DIR/serve.log"
  echo "  ilink-agent:  $ILINK_LOG_DIR/ilink-agent.log"
  echo "  digest-cron:  $CORTEX_LOG_DIR/digest-cron.log"
}

cmd_logs() {
  echo "Tailing Cortex + ilink-agent + digest-cron logs (Ctrl+C to stop)..."
  tail -f "$CORTEX_LOG_DIR/serve.log" "$ILINK_LOG_DIR/ilink-agent.log" "$CORTEX_LOG_DIR/digest-cron.log" 2>/dev/null
}

# --- Main ---
case "${1:-}" in
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  start)     cmd_start ;;
  stop)      cmd_stop ;;
  restart)   cmd_restart ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  *)
    echo "Usage: $0 {install|uninstall|start|stop|restart|status|logs}"
    exit 1
    ;;
esac
