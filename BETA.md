# Cortex + WeChat Agent: Private Beta Guide

## What is this?

Cortex is a personal knowledge infrastructure for knowledge workers (especially VCs and researchers). You send content through WeChat, Cortex automatically structures, tags, and connects it. A local web console lets you review, triage notifications, and explore connections.

**Core loop:** WeChat message -> auto-classification -> knowledge graph -> signal detection -> push notification back to WeChat -> review in Console.

## Who is this for?

- High-frequency knowledge workers who receive lots of articles, notes, and conversations daily
- People who want zero-friction capture (just forward to WeChat)
- Users comfortable running local services on macOS

## Prerequisites

| Requirement | Notes |
|---|---|
| macOS (Apple Silicon) | Tested on M1/M4 MacBook Air |
| Python 3.11+ | via `uv` (recommended) |
| Bun 1.x | for the WeChat agent |
| PostgreSQL 16+ with pgvector | local or remote |
| Cortex backend | `github.com/<your-org>/cortex` |
| cortex-wechat | `github.com/<your-org>/cortex-wechat` |

## Quick Install

```bash
# 1. Clone both repos
git clone <cortex-repo> ~/Projects/cortex
git clone <cortex-wechat-repo> ~/Projects/cortex-wechat

# 2. Install Cortex backend
cd ~/Projects/cortex
uv sync

# 3. Set up database (if not already)
createdb cortex
uv run cortex migrate

# 4. Start Cortex
uv run cortex serve
# Verify: curl http://127.0.0.1:8420/api/v1/health

# 5. Install WeChat agent
cd ~/Projects/cortex-wechat
bun install

# 6. Configure LLM (optional, for smart message routing)
export LLM_BASE_URL="https://api.minimax.chat/v1"
export LLM_API_KEY="your-key"
export LLM_MODEL="MiniMax-M2.7"

# 7. Start WeChat agent
bun run start:ilink
# Scan the QR code with WeChat when prompted

# 8. Open Console
open http://127.0.0.1:8420/console
```

## Running as Services (Persistent)

```bash
cd ~/Projects/cortex-wechat
./scripts/cortex-services.sh install
./scripts/cortex-services.sh start
./scripts/cortex-services.sh status
```

## Daily Usage

### Via WeChat
- Send any URL -> auto-ingested as article with tags
- Send text -> classified as note, chat, or command
- Send "inbox" or "有什么要处理的" -> see pending notifications
- Send "help" -> see available commands

### Via Console (http://127.0.0.1:8420/console)
- **Overview** — dashboard of recent activity and knowledge distribution
- **Inbox** — triage notifications (read/ack/dismiss), view context for each
- **Signals** — detected patterns and connections, with feedback actions
- **Events** — browse all ingested knowledge, expand for detail, view related context

### Notification Actions
In WeChat, reply to a notification with:
- `确认 <shortID>` — acknowledge
- `已读 <shortID>` — mark as read
- `忽略 <shortID>` — dismiss

## Upgrading

```bash
cd ~/Projects/cortex && git pull
cd ~/Projects/cortex-wechat && git pull && bun install
./scripts/cortex-services.sh restart
./scripts/cortex-services.sh status
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Cortex API unreachable | `lsof -ti:8420 \| xargs kill; uv run cortex serve` |
| WeChat session expired | Delete `~/.cortex/wechat/account.json`, restart agent, re-scan QR |
| LLM routing not working | Check `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` are set. For launchd, add to wrapper script. |
| launchd service not starting | Check `~/Library/Logs/cortex/*.err`. Run `./scripts/cortex-services.sh logs` |
| No notifications pushed | Verify primary recipient: `cat ~/.cortex/wechat/primary_recipient.json` |

## Submitting Feedback

Please report issues, suggestions, and feature requests to:
- GitHub Issues on the cortex-wechat repo
- Or directly via WeChat to the maintainer

**Key questions we want to learn from beta:**
1. Are the notifications useful? Too many / too few?
2. Do you use Console or WeChat commands more?
3. What content types do you send most?
4. What's missing from the context/relations view?
