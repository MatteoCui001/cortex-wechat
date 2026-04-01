/**
 * @cortex-wechat/core — shared kernel for all Cortex messaging adapters.
 */
export { CortexClient } from "./cortex-client";
export { CommandRouter } from "./router";
export type { RouterOptions } from "./router";
export { IntentExtractor, MessageHistory, type LLMFailReason } from "./intent-extractor";
export { splitReply } from "./reply-formatter";
export { loadConfig, loadLLMConfig } from "./config";
export type {
  InboundMessage,
  OutboundReply,
  NotificationSummary,
  CortexConfig,
  LLMConfig,
  ParsedIntent,
} from "./types";
