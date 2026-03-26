---
name: cortex
description: >
  Connect to a local Cortex knowledge system. Ingest content (articles, notes),
  check notifications, provide signal feedback. Use when the user mentions
  "cortex", "收件箱", "inbox", "ingest", "收录", or wants to interact with
  their knowledge base.
version: 0.1.0
metadata:
  openclaw:
    requires:
      bins: [curl]
    primaryEnv: CORTEX_BASE_URL
    os: [macos, linux]
---

# Cortex — Knowledge System Skill

Interact with a local Cortex knowledge system through REST API calls.

## Prerequisites

Cortex API must be running locally. Default: `http://127.0.0.1:8420/api/v1`

Check health:
```bash
curl -s http://127.0.0.1:8420/api/v1/health
```

If not running, tell the user to start it:
```bash
cd ~/Projects/cortex && make serve
```

## When to Use

- User wants to save/ingest content (articles, links, notes, meeting takeaways)
- User asks about their inbox, notifications, or pending items
- User wants to give feedback on a signal (useful, not useful, wrong)
- User mentions "cortex", "收件箱", "inbox", "ingest", "收录"

## When NOT to Use

- General conversation or questions unrelated to knowledge management
- Tasks that don't involve storing, retrieving, or managing knowledge

## API Reference

Base URL: `${CORTEX_BASE_URL:-http://127.0.0.1:8420/api/v1}`

### Ingest content

Submit text or URL to the knowledge system:

```bash
# Ingest a URL (article, blog post, etc.)
curl -s -X POST http://127.0.0.1:8420/api/v1/events/ingest \
  -H "Content-Type: application/json" \
  -d '{"url":"<URL>","source":"openclaw","workspace_id":"default"}'

# Ingest text (note, meeting summary, etc.)
curl -s -X POST http://127.0.0.1:8420/api/v1/events/ingest \
  -H "Content-Type: application/json" \
  -d '{"content":"<TEXT>","title":"<TITLE>","source":"openclaw","workspace_id":"default"}'

# Ingest with user annotation
curl -s -X POST http://127.0.0.1:8420/api/v1/events/ingest \
  -H "Content-Type: application/json" \
  -d '{"url":"<URL>","user_annotation":"<NOTE>","source":"openclaw","workspace_id":"default"}'
```

Response includes `id`, `title`, `tags`, `thesis_links`.

### Check inbox / notifications

```bash
# List pending notifications
curl -s "http://127.0.0.1:8420/api/v1/notifications?status=pending,delivered&limit=20"

# List all notifications
curl -s "http://127.0.0.1:8420/api/v1/notifications?limit=20"

# Refresh (trigger detection first, then list)
curl -s "http://127.0.0.1:8420/api/v1/notifications?refresh=true&limit=20"
```

Response is an array of notifications with `id`, `title`, `body`, `priority`, `status`, `source_kind`.

### Act on notifications

```bash
# Mark as read
curl -s -X POST http://127.0.0.1:8420/api/v1/notifications/<ID>/read

# Acknowledge
curl -s -X POST http://127.0.0.1:8420/api/v1/notifications/<ID>/ack

# Dismiss
curl -s -X POST http://127.0.0.1:8420/api/v1/notifications/<ID>/dismiss
```

### Signal feedback

```bash
# Submit feedback (verdict: useful, not_useful, wrong, save_for_later)
curl -s -X POST http://127.0.0.1:8420/api/v1/signals/<SIGNAL_ID>/feedback \
  -H "Content-Type: application/json" \
  -d '{"verdict":"useful"}'

# With note
curl -s -X POST http://127.0.0.1:8420/api/v1/signals/<SIGNAL_ID>/feedback \
  -H "Content-Type: application/json" \
  -d '{"verdict":"not_useful","note":"Outdated information"}'
```

### Search

```bash
curl -s -X POST http://127.0.0.1:8420/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query":"<SEARCH_QUERY>","mode":"hybrid","limit":10}'
```

## Behavior Guidelines

1. **Ingest**: When the user shares a link or text to save, call the ingest endpoint. Report back the title and tags.
2. **Inbox**: When the user asks about notifications, list them with priority markers (!!!= high, != medium). Show the short ID (first 7 chars) for easy reference.
3. **Feedback**: When the user says a signal is useful/not useful, submit the feedback and confirm.
4. **Errors**: If Cortex is not reachable, tell the user to start it with `cd ~/Projects/cortex && make serve`.
5. **IDs**: Notification and signal IDs are UUIDs. Users may reference them by short prefix (first 7 chars). Use the full ID from the API response when calling action endpoints.