/**
 * Command router — maps user text to Cortex API actions.
 *
 * All platform-agnostic logic lives here. Adapters only translate
 * their platform's message format into InboundMessage, call route(),
 * and translate OutboundReply back.
 */
import { CortexClient } from "./cortex-client";
import type { InboundMessage, NotificationSummary, OutboundReply } from "./types";

// URL regex: matches http(s) URLs in text
const URL_RE = /https?:\/\/[^\s<>"']+/i;

// Command patterns (Chinese + English)
const INBOX_RE = /^(?:收件箱|inbox|通知)$/i;
const ACK_RE = /^(?:确认|ack)\s+(\S+)/i;
const READ_RE = /^(?:已读|read)\s+(\S+)/i;
const DISMISS_RE = /^(?:忽略|dismiss)\s+(\S+)/i;
const FEEDBACK_RE = /^(?:有用|没用|useful|not_useful|wrong|save_for_later|保存)\s+(\S+)/i;
const HELP_RE = /^(?:帮助|help|\?)$/i;

const FEEDBACK_MAP: Record<string, string> = {
  有用: "useful",
  useful: "useful",
  没用: "not_useful",
  not_useful: "not_useful",
  wrong: "wrong",
  保存: "save_for_later",
  save_for_later: "save_for_later",
};

export class CommandRouter {
  constructor(private client: CortexClient) {}

  /** Route a message and return a reply. */
  async route(msg: InboundMessage): Promise<OutboundReply> {
    const reply: OutboundReply = {
      reply_text: "",
      actions_taken: [],
      pending_notifications: [],
      errors: [],
    };

    const text = msg.text.trim();

    try {
      // 1. Help
      if (HELP_RE.test(text)) {
        reply.reply_text = HELP_TEXT;
        reply.actions_taken.push("help");
        return reply;
      }

      // 2. Inbox
      if (INBOX_RE.test(text)) {
        return this.handleInbox(reply);
      }

      // 3. Ack / Read / Dismiss
      const ackMatch = text.match(ACK_RE);
      if (ackMatch) return this.handleTransition(reply, ackMatch[1], "ack");
      const readMatch = text.match(READ_RE);
      if (readMatch) return this.handleTransition(reply, readMatch[1], "read");
      const dismissMatch = text.match(DISMISS_RE);
      if (dismissMatch) return this.handleTransition(reply, dismissMatch[1], "dismiss");

      // 4. Feedback
      const feedbackMatch = text.match(FEEDBACK_RE);
      if (feedbackMatch) {
        const keyword = text.split(/\s+/)[0].toLowerCase();
        const verdict = FEEDBACK_MAP[keyword] ?? "useful";
        return this.handleFeedback(reply, feedbackMatch[1], verdict);
      }

      // 5. URL ingest
      const urlMatch = (msg.url ?? text).match(URL_RE);
      if (urlMatch) {
        return this.handleIngest(reply, { url: urlMatch[0], annotation: text !== urlMatch[0] ? text : undefined });
      }

      // 6. Plain text ingest
      return this.handleIngest(reply, { content: text });
    } catch (err: any) {
      reply.errors.push(err.message ?? String(err));
      reply.reply_text = `处理失败: ${err.message ?? err}`;
      return reply;
    }
  }

  private async handleInbox(reply: OutboundReply): Promise<OutboundReply> {
    const notifications = await this.client.getNotifications("pending,delivered", 20);
    reply.actions_taken.push("inbox");

    if (notifications.length === 0) {
      reply.reply_text = "收件箱为空，没有待处理通知。";
      return reply;
    }

    const lines = [`收件箱 (${notifications.length} 条)`, ""];
    for (const n of notifications) {
      const marker = n.priority === "high" ? "!!!" : n.priority === "medium" ? " ! " : "   ";
      lines.push(`[${marker}] ${n.short_id}  ${n.title}`);
    }
    lines.push("", "操作: 确认 <id> | 已读 <id> | 忽略 <id>");

    reply.reply_text = lines.join("\n");
    reply.pending_notifications = notifications;
    return reply;
  }

  private async handleTransition(
    reply: OutboundReply,
    id: string,
    action: "read" | "ack" | "dismiss",
  ): Promise<OutboundReply> {
    const result = await this.client.transitionNotification(id, action);
    const labels = { read: "已读", ack: "确认", dismiss: "忽略" };
    reply.actions_taken.push(`notification_${action}`);

    if (result.ok) {
      reply.reply_text = `通知 ${id.slice(0, 7)} 已标记为${labels[action]}。`;
    } else {
      reply.reply_text = `操作失败: ${result.error}`;
      reply.errors.push(result.error!);
    }
    return reply;
  }

  private async handleFeedback(
    reply: OutboundReply,
    signalId: string,
    verdict: string,
  ): Promise<OutboundReply> {
    const result = await this.client.submitFeedback(signalId, verdict);
    reply.actions_taken.push("feedback");

    if (result.ok) {
      reply.reply_text = `反馈已记录 (${verdict})。`;
    } else {
      reply.reply_text = `反馈提交失败: ${result.error}`;
      reply.errors.push(result.error!);
    }
    return reply;
  }

  private async handleIngest(
    reply: OutboundReply,
    opts: { content?: string; url?: string; annotation?: string },
  ): Promise<OutboundReply> {
    const result = await this.client.ingest({
      content: opts.content,
      url: opts.url,
      user_annotation: opts.annotation,
      source: "wechat",
    });
    reply.actions_taken.push("ingest");

    if (result) {
      const parts = [`已收录: ${result.title}`];
      if (result.tags?.length) parts.push(`标签: ${result.tags.join(", ")}`);
      reply.reply_text = parts.join("\n");
    } else {
      reply.reply_text = "内容收录失败，请稍后重试。";
      reply.errors.push("ingest_failed");
    }

    // Check for pending notifications after ingest
    try {
      const pending = await this.client.getNotifications("pending,delivered", 5);
      if (pending.length > 0) {
        reply.pending_notifications = pending;
        reply.reply_text += `\n\n你有 ${pending.length} 条待处理通知，发送"收件箱"查看。`;
      }
    } catch {
      // notification check is best-effort
    }

    return reply;
  }
}

const HELP_TEXT = `Cortex 微信助手

命令:
  转发链接 → 自动收录文章
  发送文本 → 存为笔记
  收件箱   → 查看待处理通知
  确认 <id> → 确认通知
  已读 <id> → 标记已读
  忽略 <id> → 忽略通知
  有用 <id> → Signal 反馈（有用）
  没用 <id> → Signal 反馈（没用）
  帮助     → 显示此帮助`;
