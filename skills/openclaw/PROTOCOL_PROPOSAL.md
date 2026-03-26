# OpenClaw Skill 调用协议提议

> 状态：提议中，待确认
> 日期：2026-03-26
> 目的：钉死 OpenClaw 调用 Cortex skill 的接口

---

## 背景

Cortex 作为 OpenClaw 的一个 skill，需要在用户通过微信与 OpenClaw 交互时被调用。
本文档提出 Cortex skill 的调用协议，供 OpenClaw 团队确认或修正。

---

## 提议协议：stdin/stdout JSON

### 调用方式

OpenClaw 通过子进程调用 skill 脚本，传入 JSON 到 stdin，读取 JSON 从 stdout。

```bash
echo '<input_json>' | bun scripts/handler.ts
```

### 输入 (stdin)

```json
{
  "text": "用户发送的文本",
  "user_id": "微信用户 ID",
  "session_id": "会话 ID",
  "message_id": "消息唯一 ID",
  "context_token": "iLink context token (可选)"
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `text` | string | 是 | 用户消息文本 |
| `user_id` | string | 是 | 发送者标识 |
| `session_id` | string | 否 | 会话标识，用于上下文关联 |
| `message_id` | string | 否 | 消息唯一 ID，用于去重 |
| `context_token` | string | 否 | iLink 回复路由 token |

### 输出 (stdout)

```json
{
  "reply_text": "回复给用户的文本",
  "actions_taken": ["ingest"],
  "pending_notifications": [],
  "errors": []
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `reply_text` | string | 发送给用户的回复文本 |
| `actions_taken` | string[] | 执行了哪些动作（用于日志/追踪） |
| `pending_notifications` | object[] | 待处理通知摘要 |
| `errors` | string[] | 错误信息（空 = 成功） |

### 错误处理

| 场景 | exit code | stdout |
|------|-----------|--------|
| 成功 | 0 | 正常 JSON |
| 输入解析失败 | 1 | `{"reply_text":"Invalid input","errors":["parse_error"]}` |
| Cortex API 不可达 | 0 | `{"reply_text":"Cortex 不可用","errors":["cortex_unreachable"]}` |
| 脚本崩溃 | 非 0 | stderr 有错误信息 |

---

## 需要确认的 4 个问题

### 1. Skill 调用方式

| 我们的假设 | 需要确认 |
|------------|----------|
| 子进程 + stdin JSON | 是否是这种方式？还是 HTTP callback、消息队列、或其他？ |
| 每次用户消息调用一次 | 是否支持长驻进程？还是必须是一次性脚本？ |
| Bun 作为运行时 | OpenClaw 环境是否有 Bun？需要 Node？还是只支持 Python？ |

### 2. 输入 Payload

| 我们的假设 | 需要确认 |
|------------|----------|
| 上述 5 个字段 | 实际传入的字段有哪些？有额外字段吗（如 attachments, group_id）？ |
| 纯文本消息 | 是否也会传入图片/文件的处理请求？ |
| UTF-8 JSON | 编码和格式是否有特殊要求？ |

### 3. 输出 Payload

| 我们的假设 | 需要确认 |
|------------|----------|
| 上述 4 个字段 | OpenClaw 期望什么样的 response schema？ |
| 纯文本回复 | 是否支持富文本/卡片/按钮？ |
| 单次回复 | 能否返回多条消息？ |

### 4. 超时与重试

| 我们的假设 | 需要确认 |
|------------|----------|
| 无硬性超时 | skill 执行有超时限制吗？多少秒？ |
| 无重试 | 失败后 OpenClaw 会重试吗？有幂等 key 吗？ |
| exit code 判断成败 | OpenClaw 怎么判断 skill 执行成功/失败？ |

---

## 如果协议不是 stdin/stdout

如果 OpenClaw 用的不是子进程调用，而是：

- **HTTP callback**: 我们改 `handler.ts` 为 HTTP server，监听一个端口
- **SDK/函数调用**: 我们导出一个函数，被 OpenClaw runtime import
- **消息队列**: 我们订阅 topic，发布回复

无论哪种方式，只需要改 `skills/openclaw/scripts/handler.ts` 这一个文件。
`packages/core` 的 `CommandRouter` 不需要变。
