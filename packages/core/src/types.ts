/**
 * Shared message model — platform-agnostic input/output contract.
 */

/** Inbound message from any platform */
export interface InboundMessage {
  session_id: string;
  user_id: string;
  message_id: string;
  text: string;
  /** Platform-specific token for reply routing (e.g. iLink context_token) */
  context_token?: string;
  /** Originating platform */
  platform: "ilink" | "openclaw" | "claude-code" | "cli";
  /** Optional URL extracted from message */
  url?: string;
  /** ISO timestamp */
  timestamp?: string;
}

/** Outbound reply to any platform */
export interface OutboundReply {
  /** Main reply text */
  reply_text: string;
  /** Actions that were performed */
  actions_taken: string[];
  /** Pending notifications summary (prepended to reply) */
  pending_notifications: NotificationSummary[];
  /** Errors encountered */
  errors: string[];
}

export interface NotificationSummary {
  id: string;
  short_id: string;
  title: string;
  priority: string;
  source_kind: string;
  age: string;
}

/** Cortex API configuration */
export interface CortexConfig {
  base_url: string; // e.g. http://127.0.0.1:8420/api/v1
  workspace: string;
}

/**
 * LLM provider configuration for semantic routing.
 * Users supply their own key during onboarding.
 * When absent, router falls back to regex matching.
 */
export interface LLMConfig {
  /** OpenAI-compatible base URL (e.g. https://api.openai.com/v1) */
  base_url: string;
  /** API key — user-provided */
  api_key: string;
  /** Model ID (default: anthropic/claude-haiku-4.5) */
  model?: string;
}

/** Structured intent extracted by LLM router */
export interface ParsedIntent {
  /** Recognized intent */
  intent: "help" | "inbox" | "ack" | "read" | "dismiss" | "feedback" | "ingest_url" | "ingest_text";
  /** Extracted URL, if any */
  url?: string;
  /** User's commentary / annotation on the URL */
  annotation?: string;
  /** Plain text content for ingest */
  content?: string;
  /** Target notification or signal ID */
  target_id?: string;
  /** Feedback verdict */
  verdict?: string;
}
