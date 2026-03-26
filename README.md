# cortex-wechat

Cortex 微信接入 — 双模式架构。

## 架构

```
packages/core       共享内核：消息模型、命令路由、Cortex 客户端、回复格式化
apps/ilink-agent    Mode A：iLink 直连 agent（微信未绑其他 agent 时使用）
skills/openclaw     Mode B：OpenClaw skill adapter（微信已绑 OpenClaw 时使用）
skills/claude-code  Mode B：Claude Code skill adapter（微信已绑 Claude Code 时使用）
```

## 前提

- Cortex API 运行在 `http://127.0.0.1:8420`
- Bun >= 1.0

## 快速开始

```bash
bun install

# Mode A: 直连微信
bun run start:ilink

# Mode B: 作为 skill 使用
# 安装到 Claude Code 或 OpenClaw 后按 SKILL.md 指引操作
```

## 测试

```bash
bun test
```
