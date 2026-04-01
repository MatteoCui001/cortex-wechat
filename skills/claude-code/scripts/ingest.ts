#!/usr/bin/env bun
/**
 * Cortex ingest — submit content or URL to Cortex via CLI.
 * Used as a Claude Code skill script.
 */
import { CortexClient, loadConfig } from "../../../packages/core/src/index";

const config = loadConfig();

const args = process.argv.slice(2);
let url: string | undefined;
let text: string | undefined;
let annotation: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--url" && args[i + 1]) url = args[++i];
  else if (args[i] === "--text" && args[i + 1]) text = args[++i];
  else if (args[i] === "--annotation" && args[i + 1]) annotation = args[++i];
}

if (!url && !text) {
  console.error("Usage: ingest.ts --url <url> | --text <text> [--annotation <note>]");
  process.exit(1);
}

const client = new CortexClient(config);
const result = await client.ingest({ url, content: text, user_annotation: annotation, source: "claude-code" });

if (result) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.error("Ingest failed");
  process.exit(1);
}
