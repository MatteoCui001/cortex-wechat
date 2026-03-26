#!/usr/bin/env bun
/**
 * Cortex feedback — submit signal feedback.
 */
import { CortexClient } from "../../../packages/core/src/cortex-client";
import type { CortexConfig } from "../../../packages/core/src/types";

const config: CortexConfig = {
  base_url: process.env.CORTEX_BASE_URL ?? "http://127.0.0.1:8420/api/v1",
  workspace: process.env.CORTEX_WORKSPACE ?? "default",
};

const args = process.argv.slice(2);
const signalId = args[0];
const verdict = args[1];

if (!signalId || !verdict) {
  console.error("Usage: feedback.ts <signal-id> <useful|not_useful|wrong|save_for_later> [--note TEXT]");
  process.exit(1);
}

let note: string | undefined;
const noteIdx = args.indexOf("--note");
if (noteIdx !== -1 && args[noteIdx + 1]) note = args[noteIdx + 1];

const client = new CortexClient(config);
const result = await client.submitFeedback(signalId, verdict, note);

if (result.ok) {
  console.log(`Feedback recorded: ${verdict}`);
} else {
  console.error(`Failed: ${result.error}`);
  process.exit(1);
}
