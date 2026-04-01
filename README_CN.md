# cortex-wechat

> Cortex 的微信 / Agent 接入层。

[English README](README.md)

`cortex-wechat` 负责把微信和 Agent 工作流接到 `Cortex` 主系统上。

它解决的是输入层问题：

- 在微信里转发文章、消息、想法给 Cortex
- 把 Cortex 的提醒、digest、待处理事项回推到微信
- 作为 skill 供其他 coding agent / assistant 调用

## 这个仓库是什么

这是 `Cortex` 的兄弟仓库，不是独立产品。

主仓库：
- [`cortex`](https://github.com/MatteoCui001/cortex): 后端 API、CLI、知识图谱、控制台

本仓库：
- `packages/core`: 共享消息模型、路由、Cortex client
- `apps/ilink-agent`: iLink 直连微信 agent
- `skills/openclaw`: OpenClaw skill adapter
- `skills/claude-code`: Claude Code skill adapter

## 适合谁

- 想用微信作为无摩擦输入入口的人
- 希望把 Cortex 接到日常消息流里的人
- 想把 Cortex 暴露给 Agent / skill 的开发者

## 前提

- 需要先部署主仓库 [`cortex`](https://github.com/MatteoCui001/cortex)
- 默认依赖本地 Cortex API：`http://127.0.0.1:8420/api/v1`
- Bun >= 1.0

推荐的 sibling-repo 目录结构：

```text
~/Projects/
├── cortex/
└── cortex-wechat/
```

## 快速开始

```bash
git clone https://github.com/MatteoCui001/cortex.git ~/Projects/cortex
git clone https://github.com/MatteoCui001/cortex-wechat.git ~/Projects/cortex-wechat

cd ~/Projects/cortex-wechat
./scripts/install-local.sh
```

如果只想启动 agent：

```bash
bun install
bun run start:ilink
```

## 运行模式

- Mode A: iLink 直连 agent
- Mode B: 作为 Claude Code / OpenClaw 的 skill 使用

## 开源说明

- License: MIT
- 当前版本：`v1.0.0`
- 这个仓库主要服务本地部署和个人工作流

## 相关仓库

- 主后端与控制台：[`cortex`](https://github.com/MatteoCui001/cortex)
- 微信 / Agent 接入：[`cortex-wechat`](https://github.com/MatteoCui001/cortex-wechat)
