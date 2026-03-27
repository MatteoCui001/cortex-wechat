#!/usr/bin/env bash
# Cortex services manager — install, start, stop, status, logs for launchd.
# Usage: ./scripts/cortex-services.sh <command>
#   install   — install launchd plists and create log directories
#   uninstall — unload and remove launchd plists
#   start     — load both services
#   stop      — unload both services
#   restart   — stop then start
#   status    — show service status
#   logs      — tail both service logs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_DIR="$SCRIPT_DIR/launchd"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"

CORTEX_LABEL="com.cortex.serve"
ILINK_LABEL="com.cortex.ilink-agent"
CORTEX_PLIST="$PLIST_DIR/$CORTEX_LABEL.plist"
ILINK_PLIST="$PLIST_DIR/$ILINK_LABEL.plist"

CORTEX_LOG_DIR="$HOME/Library/Logs/cortex"
ILINK_LOG_DIR="$HOME/Library/Logs/cortex-wechat"

ensure_log_dirs() {
  mkdir -p "$CORTEX_LOG_DIR" "$ILINK_LOG_DIR"
}

cmd_install() {
  ensure_log_dirs
  mkdir -p "$LAUNCH_AGENTS"
  cp "$CORTEX_PLIST" "$LAUNCH_AGENTS/$CORTEX_LABEL.plist"
  cp "$ILINK_PLIST" "$LAUNCH_AGENTS/$ILINK_LABEL.plist"
  echo "Installed:"
  echo "  $LAUNCH_AGENTS/$CORTEX_LABEL.plist"
  echo "  $LAUNCH_AGENTS/$ILINK_LABEL.plist"
  echo ""
  echo "Run './scripts/cortex-services.sh start' to load services."
}

cmd_uninstall() {
  launchctl unload "$LAUNCH_AGENTS/$CORTEX_LABEL.plist" 2>/dev/null || true
  launchctl unload "$LAUNCH_AGENTS/$ILINK_LABEL.plist" 2>/dev/null || true
  rm -f "$LAUNCH_AGENTS/$CORTEX_LABEL.plist"
  rm -f "$LAUNCH_AGENTS/$ILINK_LABEL.plist"
  echo "Uninstalled both services."
}

cmd_start() {
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

  echo ""
  echo "Logs:"
  echo "  Cortex:      $CORTEX_LOG_DIR/serve.log"
  echo "  ilink-agent: $ILINK_LOG_DIR/ilink-agent.log"
}

cmd_logs() {
  echo "Tailing Cortex + ilink-agent logs (Ctrl+C to stop)..."
  tail -f "$CORTEX_LOG_DIR/serve.log" "$ILINK_LOG_DIR/ilink-agent.log" 2>/dev/null
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