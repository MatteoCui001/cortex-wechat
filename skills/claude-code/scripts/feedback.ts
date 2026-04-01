#!/usr/bin/env bun
/**
 * Cortex feedback — submit signal feedback.
 */
import { CortexClient, loadConfig } from "../../../packages/core/src/index";

const config = loadConfig();

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
