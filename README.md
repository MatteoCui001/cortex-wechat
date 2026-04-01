# cortex-wechat

> WeChat and agent integrations for Cortex.

Public `v1.0.0` release.

English | [中文说明](README_CN.md)

`cortex-wechat` is the input and notification layer for Cortex.
It lets you forward messages and links from WeChat into Cortex, route notifications back to WeChat, and expose Cortex workflows to agent skills.

This repo is not a standalone product. It is designed to work with the main Cortex repository:
[`cortex`](https://github.com/MatteoCui001/cortex)

Recommended full setup:

```text
~/Projects/
├── cortex/
└── cortex-wechat/
```

## What This Repo Contains

- `packages/core`: shared message model, routing, Cortex client, reply formatting
- `apps/ilink-agent`: direct iLink WeChat agent
- `skills/openclaw`: OpenClaw skill adapter
- `skills/claude-code`: Claude Code skill adapter

## What It Does

- zero-friction capture through WeChat forwarding
- notification delivery back to WeChat
- agent-facing skill adapters for Cortex workflows
- local deployment flow for a personal knowledge stack

## Requirements

- the sibling [`cortex`](https://github.com/MatteoCui001/cortex) repo running locally
- Cortex API reachable at `http://127.0.0.1:8420/api/v1`
- Bun >= 1.0

## Quick Start

### Recommended: full local install

```bash
git clone https://github.com/MatteoCui001/cortex.git ~/Projects/cortex
git clone https://github.com/MatteoCui001/cortex-wechat.git ~/Projects/cortex-wechat

cd ~/Projects/cortex-wechat
./scripts/install-local.sh
```

### Agent-only setup

```bash
bun install
bun run start:ilink
```

## Modes

- Mode A: direct iLink agent for WeChat
- Mode B: skill adapter for Claude Code or OpenClaw

## Repo Guide

- Main backend + console: [`cortex`](https://github.com/MatteoCui001/cortex)
- Deployment notes: [`BETA.md`](BETA.md)
- Agent install notes: [`docs/AGENT-INSTALL.md`](docs/AGENT-INSTALL.md)

## Testing

```bash
bun x tsc --noEmit
bun test
```

## License

MIT
