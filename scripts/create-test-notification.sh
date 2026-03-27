#!/usr/bin/env bash
# Create a test pending notification in Cortex DB for push-loop verification.
# Usage: ./scripts/create-test-notification.sh [title] [priority]
#   title    — notification title (default: "测试推送通知")
#   priority — high|medium|low (default: "high")

set -euo pipefail

TITLE="${1:-测试推送通知}"
PRIORITY="${2:-high}"
WORKSPACE="${CORTEX_WORKSPACE:-default}"
DB_URL="${CORTEX_DB_URL:-postgresql://localhost:5432/cortex}"

ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DEDUP="test-$(date +%s)"

psql "$DB_URL" -c "
INSERT INTO notifications (id, title, body, priority, status, channel, workspace_id, source_kind, source_id, dedup_key, created_at)
VALUES ('$ID', '$TITLE', '由 create-test-notification.sh 创建的测试通知', '$PRIORITY', 'pending', 'inbox', '$WORKSPACE', 'test', '$DEDUP', '$DEDUP', '$NOW');
"

echo "Created pending notification:"
echo "  id:       $ID"
echo "  short_id: ${ID:0:7}"
echo "  title:    $TITLE"
echo "  priority: $PRIORITY"
echo "  status:   pending"
