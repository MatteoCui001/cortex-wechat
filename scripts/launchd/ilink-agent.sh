#!/usr/bin/env bash
# Wrapper for launchd — ensures proper environment for ilink-agent.
export PATH="/Users/cuiliangjing/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/Users/cuiliangjing"

# LLM semantic routing (MiniMax M2.7)
export LLM_BASE_URL="https://api.minimaxi.chat/v1"
export LLM_API_KEY="${LLM_API_KEY}"
export LLM_MODEL="MiniMax-M2.7"

cd /Users/cuiliangjing/Projects/cortex-wechat || exit 1
exec /Users/cuiliangjing/.bun/bin/bun run start:ilink