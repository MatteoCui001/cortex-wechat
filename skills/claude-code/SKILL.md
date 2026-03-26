---
name: cortex
description: >
  Connect to a local Cortex knowledge system. Ingest content, check notifications,
  and provide signal feedback — all through natural commands.
  Use when the user mentions "cortex", "收件箱", "inbox", "ingest", or wants to
  interact with their knowledge base.
version: 0.1.0
metadata:
  openclaw:
    requires:
      bins: [curl]
    primaryEnv: CORTEX_BASE_URL
    os: [macos, linux]
---

# Cortex Skill for Claude Code

Interact with a local Cortex knowledge system through Claude Code.

## Setup

Cortex must be running locally. Default: `http://127.0.0.1:8420/api/v1`

Set `CORTEX_BASE_URL` if using a different address.

## Available Commands

### Ingest content

```bash
# Ingest a URL
bun skills/claude-code/scripts/ingest.ts --url "https://example.com/article"

# Ingest text
bun skills/claude-code/scripts/ingest.ts --text "Meeting notes: discussed Series A terms..."

# Ingest with annotation
bun skills/claude-code/scripts/ingest.ts --url "https://..." --annotation "Relevant to AI Agent thesis"
```

### Check inbox

```bash
# List pending notifications
bun skills/claude-code/scripts/inbox.ts

# Filter by status
bun skills/claude-code/scripts/inbox.ts --status delivered

# Act on notification
bun skills/claude-code/scripts/inbox.ts --ack <id>
bun skills/claude-code/scripts/inbox.ts --read <id>
bun skills/claude-code/scripts/inbox.ts --dismiss <id>
```

### Signal feedback

```bash
bun skills/claude-code/scripts/feedback.ts <signal-id> useful
bun skills/claude-code/scripts/feedback.ts <signal-id> not_useful --note "Outdated info"
```

### Health check

```bash
bun skills/claude-code/scripts/health.ts
```
