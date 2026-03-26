# OpenClaw Skill 调用协议 — 已确认

> 状态：已确认
> 日期：2026-03-26
> 来源：openclaw/openclaw 仓库文档 (docs/concepts/system-prompt.md, docs/tools/skills.md)

---

## 核心发现：不是脚本调用，是 LLM 上下文注入

之前假设的协议（stdin/stdout JSON 子进程调用）是错误的。

**实际机制：SKILL.md 直接注入 LLM 上下文，LLM 按指令操作。**

```
用户发消息
  -> OpenClaw agent (LLM) 判断需要用 cortex skill
  -> LLM 用 read 工具读取 SKILL.md
  -> LLM 按 SKILL.md 的自然语言指令执行
  -> LLM 用 exec/bash 工具调用 curl 访问 Cortex REST API
  -> LLM 将结果格式化后回复用户
```

### 具体流程

1. **启动时过滤**：OpenClaw 扫描 skill 目录（`~/.openclaw/skills/`），
   检查 SKILL.md frontmatter 的前置条件（`requires.bins`, `requires.env`, `os`），
   合格的注入精简 XML 列表到 system prompt

2. **触发时读取**：LLM 判断用户消息匹配某个 skill 的 description，
   用 `read` 工具加载完整 SKILL.md

3. **执行**：LLM 按 SKILL.md 里的指令操作（调 CLI、curl 等）

### 这意味着

| 之前假设 | 实际情况 |
|----------|----------|
| handler.ts 脚本被子进程调用 | 不需要脚本，SKILL.md 就是全部接口 |
| stdin JSON 输入 | LLM 直接从用户消息获取意图 |
| stdout JSON 输出 | LLM 直接格式化回复 |
| 需要适配 OpenClaw runtime | 只需要写好 SKILL.md 指令 |

### 对 cortex-wechat 的影响

1. `skills/openclaw/scripts/handler.ts` 可以删除 — 不会被调用
2. `SKILL.md` 是唯一需要的文件
3. SKILL.md 里写清楚 curl 命令和使用指南即可
4. `packages/core` 的 `CommandRouter` 对 Mode B 不适用（LLM 自己做路由）
5. `handler.test.ts` 的 contract fixture 测试仍有参考价值，但不再是协议验证

### 安装方式

```bash
# 用户把 skill 目录复制到 OpenClaw skills 路径
cp -r skills/openclaw ~/.openclaw/skills/cortex
```

或通过 GitHub URL 安装（如果 OpenClaw 支持）。

---

## 4 个原始问题的答案

### 1. Skill 调用方式
- **不是子进程**，是 LLM 上下文注入
- LLM 用 `read` 工具读 SKILL.md，然后用 `exec`/`bash` 工具执行指令

### 2. 输入 Payload
- 没有固定 payload schema
- LLM 从用户自然语言消息中理解意图

### 3. 输出 Payload
- 没有固定 response schema
- LLM 直接生成自然语言回复

### 4. 超时与重试
- 受 OpenClaw agent 的整体 turn 超时限制
- 没有 skill 级别的重试机制
- 错误处理由 LLM 根据 SKILL.md 指令决定

---

## Claude Code 的 Skill 机制

经确认，Claude Code 的 skill 机制和 OpenClaw 完全相同：
- `SKILL.md` 注入 LLM 上下文
- LLM 按指令执行
- 不是脚本调用

因此 `skills/claude-code/` 的 4 个脚本（ingest.ts, inbox.ts, feedback.ts, health.ts）
作为独立 CLI 工具仍然有用，但不会被 Claude Code 的 skill 机制自动调用。
它们可以被 SKILL.md 里的指令引用为 `exec` 目标。