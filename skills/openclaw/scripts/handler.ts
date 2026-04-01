#!/usr/bin/env bun
/**
 * [LEGACY] OpenClaw adapter — reads JSON from stdin, routes through core, writes JSON to stdout.
 *
 * This file is NOT called by the OpenClaw skill mechanism. OpenClaw injects SKILL.md
 * into the LLM context and the LLM executes curl commands directly.
 * See PROTOCOL_PROPOSAL.md for details.
 *
 * Retained as reference implementation and for handler.test.ts contract tests.
 *
 * stdin contract:
 *   { text, user_id, session_id, message_id, context_token? }
 *
 * stdout contract:
 *   { reply_text, actions_taken, pending_notifications, errors }
 */
import { CommandRouter, CortexClient, loadConfig } from "../../../packages/core/src/index";
import type { InboundMessage } from "../../../packages/core/src/types";

const config = loadConfig();

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
