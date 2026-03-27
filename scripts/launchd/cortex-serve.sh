#!/usr/bin/env bash
# Wrapper for launchd — ensures proper environment for Cortex.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/Users/cuiliangjing"
cd /Users/cuiliangjing/Projects/cortex || exit 1
exec /opt/homebrew/bin/uv run cortex serve
