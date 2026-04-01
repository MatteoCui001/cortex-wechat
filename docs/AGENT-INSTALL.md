# Cortex Agent Install Specification

This document is designed to be read by AI agents (OpenClaw, Claude Code, etc.)
that need to install Cortex on a user's Mac.

## Prerequisites

- macOS (Apple Silicon or Intel)
- Terminal access via bridge/ssh

## One-Line Install

Run this single command on the user's Mac:

```bash
curl -sL https://raw.githubusercontent.com/cortex-engine/cortex/main/get-cortex.sh | bash
```

## Interactive Steps

The installer will pause twice for user input:

### 1. LLM API Key (Optional)
- Prompt: "LLM API Key（回车跳过）:"
- Action: Enter the user's LLM API key, or press Enter to skip
- Skip is safe: search and ingestion work without it
- Supported providers: MiniMax, OpenRouter, Google Gemini

### 2. WeChat QR Code (Required)
- Prompt: "按回车开始扫码（输入 skip 跳过）:"
- Action: Press Enter, then show the QR URL to the user for scanning
- The QR URL appears in the log as: "扫码链接: https://..."
- User must scan with WeChat on their phone, then confirm login
- After scan completes, press Ctrl+C — the service auto-backgrounds

If using a bridge (e.g., Capy Bridge):
1. Send `curl -sL ... | bash` via `terminal/exec`
2. Monitor output for the LLM key prompt — send the key or empty line
3. Monitor output for the QR URL — extract and relay to user via chat
4. After user confirms scan, send Ctrl+C (or the process will exit on its own)

## Post-Install Verification

```bash
# Check services are running
cortex status

# Test API health
curl -sf http://127.0.0.1:8420/api/v1/health

# Check WeChat connection
tail -5 ~/Library/Logs/cortex-wechat/ilink-agent.log
```

## Common Commands

| Command | Purpose |
|---------|---------|
| `cortex status` | Check service status |
| `cortex restart` | Restart all services |
| `cortex logs` | Tail service logs |
| `cortex config` | View/edit configuration |
| `cortex update` | Pull latest + update deps |
| `cortex doctor` | Run health diagnostics |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "cortex: command not found" | Run `sudo cp ~/Projects/cortex-wechat/scripts/cortex-cli.sh /usr/local/bin/cortex && sudo chmod +x /usr/local/bin/cortex` |
| API not responding | `cortex restart` and check `cortex logs` |
| WeChat disconnected | `cortex stop` then `cd ~/Projects/cortex-wechat && source ~/.cortex/env && bun run start:ilink` to re-scan QR |
| LLM not working | Edit `~/.cortex/env`, set `LLM_API_KEY`, then `cortex restart` |

## File Layout

```
~/.cortex/
  env                    # Shared config (API token, LLM key)
  wechat/
    account.json         # WeChat session
    allowed_senders.json # Authorized users
    cursor.txt           # Message poll cursor

~/Projects/
  cortex/                # Backend (Python)
  cortex-wechat/         # WeChat agent (TypeScript)

~/Library/
  LaunchAgents/
    com.cortex.serve.plist
    com.cortex.ilink-agent.plist
    com.cortex.digest-cron.plist
  Logs/
    cortex/serve.log
    cortex-wechat/ilink-agent.log
```
