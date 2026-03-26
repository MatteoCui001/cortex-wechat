#!/usr/bin/env bun
/**
 * OpenClaw adapter — reads JSON from stdin, routes through core, writes JSON to stdout.
 *
 * stdin contract:
 *   { text, user_id, session_id, message_id, context_token? }
 *
 * stdout contract:
 *   { reply_text, actions_taken, pending_notifications, errors }
 *
 * NOTE: The exact invocation protocol of OpenClaw is not yet confirmed.
 * This script implements the stdin/stdout JSON contract as a reasonable default.
 * When the actual protocol is confirmed, only this file needs to change.
 */
import { CommandRouter, CortexClient } from "../../../packages/core/src/index";
import type { CortexConfig, InboundMessage } from "../../../packages/core/src/types";

const config: CortexConfig = {
  base_url: process.env.CORTEX_BASE_URL ?? "http://127.0.0.1:8420/api/v1",
  workspace: process.env.CORTEX_WORKSPACE ?? "default",
};

// Read stdin
const input = await Bun.stdin.text();

let parsed: any;
try {
  parsed = JSON.parse(input);
} catch {
  console.error(JSON.stringify({ reply_text: "Invalid input", actions_taken: [], pending_notifications: [], errors: ["parse_error"] }));
  process.exit(1);
}

const msg: InboundMessage = {
  session_id: parsed.session_id ?? "",
  user_id: parsed.user_id ?? "",
  message_id: parsed.message_id ?? "",
  text: parsed.text ?? "",
  context_token: parsed.context_token,
  platform: "openclaw",
};

const client = new CortexClient(config);
const router = new CommandRouter(client);
const reply = await router.route(msg);

console.log(JSON.stringify(reply));
