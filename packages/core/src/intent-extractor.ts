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
- Pure text with no URL and no command → "ingest_text"

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "intent": "help"|"inbox"|"ack"|"read"|"dismiss"|"feedback"|"ingest_url"|"ingest_text",
  "url": "extracted URL or omit",
  "annotation": "user commentary about the URL, or omit",
  "content": "plain text for ingest_text, or omit",
  "target_id": "notification/signal ID, or omit",
  "verdict": "useful|not_useful|wrong|save_for_later, or omit"
}`;

/** Recent messages kept for cross-message correlation */
export class MessageHistory {
  private buffer: Array<{ text: string; timestamp: number }> = [];
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 5, ttlMinutes = 10) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMinutes * 60_000;
  }

  push(text: string): void {
    this.buffer.push({ text, timestamp: Date.now() });
    if (this.buffer.length > this.maxSize) this.buffer.shift();
  }

  /** Return recent messages as context string, excluding expired ones */
  getContext(): string {
    const cutoff = Date.now() - this.ttlMs;
    const recent = this.buffer.filter((m) => m.timestamp > cutoff);
    if (recent.length <= 1) return "";
    // Exclude the last one (it's the current message)
    return recent
      .slice(0, -1)
      .map((m) => m.text)
      .join("\n");
  }
}

export class IntentExtractor {
  private config: LLMConfig;
  private model: string;

  constructor(config: LLMConfig) {
    this.config = config;
    this.model = config.model ?? "anthropic/claude-haiku-4.5";
  }

  /**
   * Extract intent from a message using LLM.
   * Returns null if LLM call fails or response is unparseable.
   */
  async extract(msg: InboundMessage, history?: MessageHistory): Promise<ParsedIntent | null> {
    const recentContext = history?.getContext();
    let userContent = msg.text;
    if (recentContext) {
      userContent = `[Recent messages]\n${recentContext}\n\n[Current message]\n${msg.text}`;
    }

    try {
      const baseUrl = this.config.base_url.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/chat/completions`, {
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
      });

      if (!res.ok) return null;

      const data = (await res.json()) as any;
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) return null;

      // Strip markdown code fences if present
      const cleaned = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(cleaned) as ParsedIntent;

      // Validate intent is one of expected values
      const validIntents = ["help", "inbox", "ack", "read", "dismiss", "feedback", "ingest_url", "ingest_text"];
      if (!validIntents.includes(parsed.intent)) return null;

      return parsed;
    } catch {
      return null;
    }
  }
}
