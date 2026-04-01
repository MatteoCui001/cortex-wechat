/**
 * LLM-based intent extraction for semantic message routing.
 *
 * Calls an OpenAI-compatible chat completions endpoint to parse user
 * messages into structured intents.  When LLM is unavailable or the
 * response is unparseable, returns null so the caller can fall back
 * to regex matching.
 */
import type { LLMConfig, ParsedIntent, InboundMessage } from "./types";

const SYSTEM_PROMPT = `You are a message classifier for a WeChat-based knowledge assistant called Cortex.

Given the user's current message and recent message history, extract a structured intent.

Rules:
- If the message contains a URL (http/https), the intent is "ingest_url". Extract the URL separately from any commentary.
- If the user is giving feedback or commentary about a previously shared URL (even without the URL in this message), set intent to "ingest_url", leave url empty, and put commentary in "annotation".
- Commands like 收件箱/inbox → "inbox", 帮助/help/? → "help"
- 确认/ack + ID → "ack", 已读/read + ID → "read", 忽略/dismiss + ID → "dismiss"
- 有用/没用/useful/not_useful + ID → "feedback"
- If the user is asking a question, seeking analysis, requesting opinions, or having a conversation (NOT a command and NOT content to save), the intent is "chat". Put the full message in "content".
- Short factual notes the user clearly wants to save (e.g. "会议纪要：…", "记一下…") → "ingest_text"
- When ambiguous between chat and ingest_text, prefer "chat" — it's easier to save later than to miss a conversation.

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "intent": "help"|"inbox"|"ack"|"read"|"dismiss"|"feedback"|"ingest_url"|"ingest_text"|"chat",
  "url": "extracted URL or omit",
  "annotation": "user commentary about the URL, or omit",
  "content": "plain text for ingest_text or chat, or omit",
  "target_id": "notification/signal ID, or omit",
  "verdict": "useful|not_useful|wrong|save_for_later, or omit"
}`;

/** LLM extraction failure reason — for structured logging */
export type LLMFailReason = "llm_timeout" | "llm_http_error" | "llm_parse_error" | "llm_empty_response";

interface Entry {
  text: string;
  timestamp: number;
}

/**
 * Session-isolated message history for cross-message correlation.
 *
 * Maintains a separate FIFO buffer per session key (session_id or user_id).
 * Each buffer holds at most `maxSize` entries within a `ttlMinutes` window.
 */
export class MessageHistory {
  private sessions = new Map<string, Entry[]>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 5, ttlMinutes = 10) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMinutes * 60_000;
  }

  /** Derive a session key from a message (session_id preferred, fallback user_id) */
  static keyFor(msg: InboundMessage): string {
    return msg.session_id || msg.user_id;
  }

  push(key: string, text: string): void {
    let buf = this.sessions.get(key);
    if (!buf) {
      buf = [];
      this.sessions.set(key, buf);
    }
    buf.push({ text, timestamp: Date.now() });
    if (buf.length > this.maxSize) buf.shift();
  }

  /** Return recent messages as context string, excluding expired and current */
  getContext(key: string): string {
    const buf = this.sessions.get(key);
    if (!buf || buf.length <= 1) return "";
    const cutoff = Date.now() - this.ttlMs;
    const recent = buf.filter((m) => m.timestamp > cutoff);
    if (recent.length <= 1) return "";
    return recent
      .slice(0, -1)
      .map((m) => m.text)
      .join("\n");
  }

  /** Number of tracked sessions (for monitoring) */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Find the most recent URL in a session's history (for cross-message annotation) */
  findRecentUrl(key: string): string | undefined {
    const buf = this.sessions.get(key);
    if (!buf) return undefined;
    const cutoff = Date.now() - this.ttlMs;
    const urlRe = /https?:\/\/[^\s<>"'\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/i;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].timestamp <= cutoff) break;
      const m = buf[i].text.match(urlRe);
      if (m) return m[0];
    }
    return undefined;
  }

  /** Evict sessions with no recent activity (call periodically to prevent leaks) */
  gc(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, buf] of this.sessions) {
      const last = buf[buf.length - 1];
      if (!last || last.timestamp <= cutoff) {
        this.sessions.delete(key);
      }
    }
  }
}

const DEFAULT_TIMEOUT_MS = 15000;

export class IntentExtractor {
  private config: LLMConfig;
  private model: string;
  private timeoutMs: number;

  constructor(config: LLMConfig) {
    this.config = config;
    this.model = config.model ?? "MiniMax-M2.7";
    this.timeoutMs = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Extract intent from a message using LLM.
   * Returns null (+ reason) if LLM call fails or response is unparseable.
   */
  async extract(
    msg: InboundMessage,
    history?: MessageHistory,
  ): Promise<{ intent: ParsedIntent; reason?: never } | { intent: null; reason: LLMFailReason }> {
    const key = MessageHistory.keyFor(msg);
    const recentContext = history?.getContext(key);
    let userContent = msg.text;
    if (recentContext) {
      userContent = `[Recent messages]\n${recentContext}\n\n[Current message]\n${msg.text}`;
    }

    try {
      const baseUrl = this.config.base_url.replace(/\/$/, "");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.api_key}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userContent },
            ],
            temperature: 0,
            max_tokens: 200,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        return { intent: null, reason: "llm_http_error" };
      }

      const data = (await res.json()) as any;
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) {
        return { intent: null, reason: "llm_empty_response" };
      }

      // Strip reasoning tags (e.g. <think>...</think>) and markdown code fences
      let cleaned = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(cleaned) as ParsedIntent;

      const validIntents = ["help", "inbox", "ack", "read", "dismiss", "feedback", "ingest_url", "ingest_text", "chat"];
      if (!validIntents.includes(parsed.intent)) {
        return { intent: null, reason: "llm_parse_error" };
      }

      return { intent: parsed };
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return { intent: null, reason: "llm_timeout" };
      }
      return { intent: null, reason: "llm_parse_error" };
    }
  }
}
