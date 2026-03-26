/**
 * @cortex-wechat/core — shared kernel for all Cortex messaging adapters.
 */
export { CortexClient } from "./cortex-client";
export { CommandRouter } from "./router";
export { splitReply } from "./reply-formatter";
export type {
  InboundMessage,
  OutboundReply,
  NotificationSummary,
  CortexConfig,
} from "./types";
