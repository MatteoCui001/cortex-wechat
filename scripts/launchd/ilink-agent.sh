#!/usr/bin/env bash
# Wrapper for launchd — ensures proper environment for ilink-agent.
export PATH="/Users/cuiliangjing/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/Users/cuiliangjing"
cd /Users/cuiliangjing/Projects/cortex-wechat || exit 1
exec /Users/cuiliangjing/.bun/bin/bun run start:ilink
