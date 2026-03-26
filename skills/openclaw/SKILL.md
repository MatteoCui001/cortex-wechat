---
name: cortex
description: >
  Connect to a local Cortex knowledge system via OpenClaw.
  Ingest content, check notifications, and provide signal feedback.
  Trigger: "cortex", "收件箱", "inbox", "ingest", knowledge base interactions.
version: 0.1.0
metadata:
  openclaw:
    requires:
      bins: [bun]
    primaryEnv: CORTEX_BASE_URL
    os: [macos]
---

# Cortex Skill for OpenClaw

Interact with a local Cortex knowledge system through OpenClaw.

## How It Works

This skill wraps the shared Cortex core. When OpenClaw routes a user message
to this skill, it:

1. Parses the message using the shared command router
2. Calls the appropriate Cortex REST API endpoint
3. Returns a text reply

## Supported Commands

| User says | Action | Cortex API |
|-----------|--------|------------|
| Forward a link | Ingest article | `POST /events/ingest` |
| Plain text | Ingest as note | `POST /events/ingest` |
| 收件箱 / inbox | List notifications | `GET /notifications` |
| 确认 / ack `<id>` | Acknowledge | `POST /notifications/{id}/ack` |
| 已读 / read `<id>` | Mark read | `POST /notifications/{id}/read` |
| 忽略 / dismiss `<id>` | Dismiss | `POST /notifications/{id}/dismiss` |
| 有用 / useful `<id>` | Signal feedback | `POST /signals/{id}/feedback` |
| 帮助 / help | Show commands | Local |

## Setup

Cortex must be running locally at `http://127.0.0.1:8420`.
Set `CORTEX_BASE_URL` to override.

## Script Interface

The OpenClaw adapter script reads JSON from stdin and writes JSON to stdout:

```bash
echo '{"text":"收件箱","user_id":"wx123","session_id":"s1","message_id":"m1"}' | bun scripts/handler.ts
```

Output:
```json
{"reply_text":"收件箱 (3 条)\n...","actions_taken":["inbox"],"pending_notifications":[...],"errors":[]}
```
