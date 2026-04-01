/**
 * Command router — maps user text to Cortex API actions.
 *
 * Two-tier routing:
 *   1. LLM intent extraction (when LLMConfig is provided)
 *   2. Regex fallback (always available, used when LLM is absent or fails)
 *
 * All platform-agnostic logic lives here. Adapters only translate
 * their platform's message format into InboundMessage, call route(),
 * and translate OutboundReply back.
 */
import { CortexClient } from "./cortex-client";
import { IntentExtractor, MessageHistory, type LLMFailReason } from "./intent-extractor";
import type { InboundMessage, LLMConfig, NotificationSummary, OutboundReply, ParsedIntent } from "./types";

// ---------------------------------------------------------------------------
// Regex patterns (fallback tier)
// ---------------------------------------------------------------------------

// URL regex: matches http(s) URLs, stopping at CJK characters and common
// punctuation that signal the start of user commentary.
const URL_RE = /https?:\/\/[^\s<>"'\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/i;

// Command patterns (Chinese + English)
const INBOX_RE = /^(?:收件箱|inbox|通知)$/i;
const ACK_RE = /^(?:确认|ack)\s+(\S+)/i;
const READ_RE = /^(?:已读|read)\s+(\S+)/i;
const DISMISS_RE = /^(?:忽略|dismiss)\s+(\S+)/i;
const FEEDBACK_RE = /^(?:有用|没用|useful|not_useful|wrong|save_for_later|保存)\s+(\S+)/i;
const HELP_RE = /^(?:帮助|help|\?)$/i;
const THESIS_LIST_RE = /^(?:论点|theses?|thesis\s*list)$/i;
const THESIS_CONFIRM_RE = /^(?:确认论点|confirm\s+thesis)\s+(\S+)/i;
const THESIS_GENERATE_RE = /^(?:生成论点|generate\s+theses?)\s+(.+)/i;
const THESIS_EVIDENCE_RE = /^(?:证据|evidence)\s+(\S+)/i;
const SEARCH_RE = /^(?:搜索|search|找)\s+(.+)/i;
const DIGEST_RE = /^(?:日报|digest|摘要)(?:\s+(\d+))?$/i;
const STATS_RE = /^(?:统计|stats|状态)$/i;
const MENU_RE = /^(?:菜单|menu|命令)$/i;

const FEEDBACK_MAP: Record<string, string> = {
  有用: "useful",
  useful: "useful",
  没用: "not_useful",
  not_useful: "not_useful",
  wrong: "wrong",
  保存: "save_for_later",
  save_for_later: "save_for_later",
};

export interface RouterOptions {
  /** Optional LLM config — when provided, enables semantic routing */
  llm?: LLMConfig;
}

export class CommandRouter {
  private client: CortexClient;
  private extractor: IntentExtractor | null = null;
  private history: MessageHistory;
  /** Optional callback for LLM routing events (for structured logging) */
  onLLMEvent?: (event: "llm_success" | "llm_fallback_regex", reason?: LLMFailReason) => void;

  constructor(client: CortexClient, opts?: RouterOptions) {
    this.client = client;
    this.history = new MessageHistory(5, 10);
    if (opts?.llm) {
      this.extractor = new IntentExtractor(opts.llm);
    }
  }

  /** Whether LLM routing is enabled */
  get llmEnabled(): boolean {
    return this.extractor !== null;
  }

  /** Route a message and return a reply. */
  async route(msg: InboundMessage): Promise<OutboundReply> {
    const reply: OutboundReply = {
      reply_text: "",
      actions_taken: [],
      pending_notifications: [],
      errors: [],
    };

    const text = msg.text.trim();
    const key = MessageHistory.keyFor(msg);
    this.history.push(key, text);

    try {
      // Tier 1: LLM intent extraction
      if (this.extractor) {
        const result = await this.extractor.extract(msg, this.history);
        if (result.intent) {
          this.onLLMEvent?.("llm_success");
          return this.dispatchIntent(reply, result.intent, text, key);
        }
        // LLM failed — fall through to regex with reason
        this.onLLMEvent?.("llm_fallback_regex", result.reason);
      }

      // Tier 2: Regex fallback
      return this.regexRoute(reply, msg, text);
    } catch (err: any) {
      reply.errors.push(err.message ?? String(err));
      reply.reply_text = `处理失败: ${err.message ?? err}`;
      return reply;
    }
  }

  // ---------------------------------------------------------------------------
  // Tier 1: dispatch from LLM-parsed intent
  // ---------------------------------------------------------------------------

  private async dispatchIntent(
    reply: OutboundReply,
    intent: ParsedIntent,
    originalText: string,
    sessionKey?: string,
  ): Promise<OutboundReply> {
    switch (intent.intent) {
      case "help":
        reply.reply_text = HELP_TEXT;
        reply.actions_taken.push("help");
        return reply;

      case "menu":
        reply.reply_text = MENU_TEXT;
        reply.actions_taken.push("menu");
        return reply;

      case "inbox":
        return this.handleInbox(reply);

      case "ack":
        return this.handleTransition(reply, intent.target_id!, "ack");
      case "read":
        return this.handleTransition(reply, intent.target_id!, "read");
      case "dismiss":
        return this.handleTransition(reply, intent.target_id!, "dismiss");

      case "feedback":
        return this.handleFeedback(reply, intent.target_id!, intent.verdict ?? "useful");

      case "ingest_url": {
        // Cross-message: LLM may return ingest_url with annotation but no URL
        // when the user comments on a previously shared link.
        let url = intent.url;
        if (!url && sessionKey) {
          url = this.history.findRecentUrl(sessionKey);
        }
        return this.handleIngest(reply, {
          url,
          annotation: intent.annotation,
          content: url ? undefined : originalText,
        });
      }

      case "ingest_text":
        return this.handleIngest(reply, { content: intent.content || originalText });

      case "thesis_list":
        return this.handleThesisList(reply);
      case "thesis_generate":
        return this.handleThesisGenerate(reply, intent.content || originalText);
      case "thesis_confirm":
        return this.handleThesisConfirm(reply, intent.target_id!);
      case "thesis_evidence":
        return this.handleThesisEvidence(reply, intent.target_id!);
      case "search":
        return this.handleSearch(reply, intent.content || originalText);
      case "digest":
        return this.handleDigest(reply);
      case "stats":
        return this.handleStats(reply);

      default:
        // Unknown intent — treat as plain text ingest
        return this.handleIngest(reply, { content: originalText });
    }
  }

  // ---------------------------------------------------------------------------
  // Tier 2: regex fallback
  // ---------------------------------------------------------------------------

  private async regexRoute(
    reply: OutboundReply,
    msg: InboundMessage,
    text: string,
  ): Promise<OutboundReply> {
    // 1. Help
    if (HELP_RE.test(text)) {
      reply.reply_text = HELP_TEXT;
      reply.actions_taken.push("help");
      return reply;
    }

    // 1.5 Menu (quick command reference)
    if (MENU_RE.test(text)) {
      reply.reply_text = MENU_TEXT;
      reply.actions_taken.push("menu");
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

    // 5. Thesis commands
    if (THESIS_LIST_RE.test(text)) return this.handleThesisList(reply);
    const thesisConfirmMatch = text.match(THESIS_CONFIRM_RE);
    if (thesisConfirmMatch) return this.handleThesisConfirm(reply, thesisConfirmMatch[1]);
    const thesisGenMatch = text.match(THESIS_GENERATE_RE);
    if (thesisGenMatch) return this.handleThesisGenerate(reply, thesisGenMatch[1]);
    const evidenceMatch = text.match(THESIS_EVIDENCE_RE);
    if (evidenceMatch) return this.handleThesisEvidence(reply, evidenceMatch[1]);

    // 6. Search / Digest / Stats
    const searchMatch = text.match(SEARCH_RE);
    if (searchMatch) return this.handleSearch(reply, searchMatch[1]);
    if (DIGEST_RE.test(text)) {
      const daysMatch = text.match(DIGEST_RE);
      return this.handleDigest(reply, daysMatch?.[1] ? Number(daysMatch[1]) : undefined);
    }
    if (STATS_RE.test(text)) return this.handleStats(reply);

    // 7. URL ingest
    const urlMatch = (msg.url ?? text).match(URL_RE);
    if (urlMatch) {
      const remainder = text.replace(urlMatch[0], "").trim();
      return this.handleIngest(reply, { url: urlMatch[0], annotation: remainder || undefined });
    }

    // 8. Fuzzy command matching — catch typos before silent ingest
    const suggestion = this.suggestCommand(text);
    if (suggestion) {
      reply.reply_text = suggestion;
      reply.actions_taken.push("suggest");
      return reply;
    }

    // 9. Cross-message URL context — check if this is commentary on a recent URL
    const sessionKey = MessageHistory.keyFor(msg);
    const recentUrl = this.history.findRecentUrl(sessionKey);
    if (recentUrl) {
      return this.handleIngest(reply, { url: recentUrl, annotation: text });
    }

    // 10. Plain text ingest
    return this.handleIngest(reply, { content: text });
  }

  // ---------------------------------------------------------------------------
  // Shared handlers
  // ---------------------------------------------------------------------------

  /** Check if text looks like a mistyped command and suggest the correct one. */
  private suggestCommand(text: string): string | null {
    const t = text.trim();
    // Only check short texts (commands are short; long text is likely a note)
    if (t.length > 20 || t.length < 2) return null;

    // Known command keywords and their correct forms
    const commands: Array<[RegExp, string]> = [
      [/^[已己巳以][读渎赌独犊毒]/, "已读 <id>"],
      [/^[确却雀鹊][认人仁忍]/, "确认 <id>"],
      [/^[忽乎呼互][略落络]/, "忽略 <id>"],
      [/^[收受首手][件间建键]/, "收件箱"],
      [/^[帮邦绑棒][助住柱注]/, "帮助"],
      [/^[论伦轮][点典电]/, "论点"],
      [/^[统桶同][计记纪]/, "统计"],
      [/^[日目][报抱暴]/, "日报"],
      [/^[搜收手][索锁]/, "搜索 <关键词>"],
      [/^[证正政][据居巨]/, "证据 <id>"],
    ];

    for (const [pattern, correctForm] of commands) {
      if (pattern.test(t) && !this.matchesAnyCommand(t)) {
        return `你是不是想说"${correctForm}"？发送"帮助"查看完整命令列表。`;
      }
    }

    return null;
  }

  /** Check if text matches any existing command regex */
  private matchesAnyCommand(text: string): boolean {
    return HELP_RE.test(text) || MENU_RE.test(text) || INBOX_RE.test(text) || ACK_RE.test(text) ||
      READ_RE.test(text) || DISMISS_RE.test(text) || FEEDBACK_RE.test(text) ||
      THESIS_LIST_RE.test(text) || THESIS_CONFIRM_RE.test(text) ||
      THESIS_GENERATE_RE.test(text) || THESIS_EVIDENCE_RE.test(text) ||
      SEARCH_RE.test(text) || DIGEST_RE.test(text) || STATS_RE.test(text);
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
    lines.push("", "操作: 确认 <id> | 已读 <id> | 忽略 <id> | 有用 <id>");

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

  private async handleThesisList(reply: OutboundReply): Promise<OutboundReply> {
    const theses = await this.client.listTheses("active");
    reply.actions_taken.push("thesis_list");
    if (theses.length === 0) {
      reply.reply_text = "暂无活跃论点。";
      return reply;
    }
    const lines = [`活跃论点 (${theses.length} 条)`, ""];
    for (const t of theses) {
      const stance = t.stance === "bullish" ? "看多" : t.stance === "bearish" ? "看空" : "中性";
      const conf = t.confirmed ? "" : " [待确认]";
      lines.push(`[${t.id.slice(0, 7)}] ${stance} ${t.text.slice(0, 60)}${conf}`);
    }
    lines.push("", "操作: 确认论点 <id> | 证据 <id> | 生成论点 <主题>");
    reply.reply_text = lines.join("\n");
    return reply;
  }

  private async handleThesisConfirm(reply: OutboundReply, id: string): Promise<OutboundReply> {
    const result = await this.client.confirmThesis(id);
    reply.actions_taken.push("thesis_confirm");
    if (result.ok) {
      reply.reply_text = `论点 ${id.slice(0, 7)} 已确认。系统将开始评估相关证据。`;
    } else {
      reply.reply_text = `确认失败: ${result.error}`;
      reply.errors.push(result.error!);
    }
    return reply;
  }

  private async handleThesisGenerate(reply: OutboundReply, theme: string): Promise<OutboundReply> {
    const theses = await this.client.generateTheses(theme.trim());
    reply.actions_taken.push("thesis_generate");
    if (theses.length === 0) {
      reply.reply_text = `主题 "${theme}" 下没有足够的事件来生成论点。`;
      return reply;
    }
    const lines = [`为 "${theme}" 生成了 ${theses.length} 条论点:`, ""];
    for (const t of theses) {
      lines.push(`[${t.id.slice(0, 7)}] ${t.text.slice(0, 80)}`);
    }
    lines.push("", "发送 确认论点 <id> 来激活。");
    reply.reply_text = lines.join("\n");
    return reply;
  }

  private async handleThesisEvidence(reply: OutboundReply, id: string): Promise<OutboundReply> {
    const evidence = await this.client.getEvidence(id, 10);
    reply.actions_taken.push("thesis_evidence");
    if (evidence.length === 0) {
      reply.reply_text = `论点 ${id.slice(0, 7)} 暂无相关证据。`;
      return reply;
    }
    const lines = [`论点 ${id.slice(0, 7)} 的证据 (${evidence.length} 条):`, ""];
    for (const e of evidence) {
      const icon = e.impact === "supports" ? "+" : e.impact === "contradicts" ? "-" : "~";
      const title = e.event_title?.slice(0, 40) || e.event_id.slice(0, 7);
      lines.push(`  [${icon}] ${title} (delta: ${e.confidence_delta.toFixed(2)})`);
      if (e.rationale) lines.push(`      ${e.rationale.slice(0, 60)}`);
    }
    reply.reply_text = lines.join("\n");
    return reply;
  }

  private async handleSearch(reply: OutboundReply, query: string): Promise<OutboundReply> {
    const results = await this.client.search(query.trim(), 5);
    reply.actions_taken.push("search");
    if (results.length === 0) {
      reply.reply_text = `未找到与 "${query}" 相关的内容。`;
      return reply;
    }
    const lines = [`搜索结果 (${results.length} 条):`, ""];
    for (const r of results) {
      const e = r.event ?? r;
      const score = r.score ? ` (${(r.score * 100).toFixed(0)}%)` : "";
      lines.push(`  ${e.title?.slice(0, 50) || "无标题"}${score}`);
      if (e.summary) lines.push(`    ${e.summary.slice(0, 60)}`);
    }
    reply.reply_text = lines.join("\n");
    return reply;
  }

  private async handleDigest(reply: OutboundReply, days?: number): Promise<OutboundReply> {
    const data = await this.client.digest(days ?? 7);
    reply.actions_taken.push("digest");
    if (!data) {
      reply.reply_text = "摘要生成失败。";
      return reply;
    }
    const lines = [`最近 ${days ?? 7} 天摘要:`, ""];
    if (data.total_events !== undefined) lines.push(`事件: ${data.total_events}`);
    if (data.top_themes?.length) lines.push(`热门主题: ${data.top_themes.slice(0, 5).join(", ")}`);
    if (data.narrative) lines.push("", data.narrative);
    if (lines.length <= 2) lines.push("暂无数据。");
    reply.reply_text = lines.join("\n");
    return reply;
  }

  private async handleStats(reply: OutboundReply): Promise<OutboundReply> {
    const data = await this.client.stats();
    reply.actions_taken.push("stats");
    if (!data) {
      reply.reply_text = "统计获取失败。";
      return reply;
    }
    const lines = [
      "Cortex 统计:",
      `  事件: ${data.events ?? 0}`,
      `  实体: ${data.entities ?? 0}`,
      `  关系: ${data.relations ?? 0}`,
    ];
    if (data.type_distribution) {
      lines.push("  类型分布:");
      for (const [t, c] of Object.entries(data.type_distribution)) {
        lines.push(`    ${t}: ${c}`);
      }
    }
    reply.reply_text = lines.join("\n");
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

收录:
  发送链接 → 自动收录文章
  发送文本 → 存为笔记

通知:
  收件箱     → 查看待处理通知
  确认 <id>  → 确认通知
  已读 <id>  → 标记已读
  忽略 <id>  → 忽略通知

论点:
  论点           → 查看活跃论点
  确认论点 <id>  → 确认论点
  证据 <id>      → 查看论点证据
  生成论点 <主题> → AI 生成论点

查询:
  搜索 <关键词>  → 搜索知识库
  日报           → 最近 7 天摘要
  日报 <天数>    → 指定天数摘要
  摘要           → 同「日报」
  统计           → 系统状态

反馈:
  有用 <id>  → Signal 正面反馈
  没用 <id>  → Signal 负面反馈
  保存 <id>  → 稍后查看

菜单 → 快捷命令
帮助 → 显示此帮助`;

const MENU_TEXT = `快捷命令:

[收录] 直接发链接或文字
[收件箱] 查看通知
[日报] 今日摘要
[论点] 投资论点
[搜索 <词>] 搜索知识库
[统计] 系统状态

发"帮助"查看完整命令列表`;
