#!/usr/bin/env bun
/**
 * Cortex health check.
 */
import { CortexClient, loadConfig } from "../../../packages/core/src/index";

const config = loadConfig();
const client = new CortexClient(config);
const ok = await client.health();

if (ok) {
  console.log(`Cortex is healthy at ${config.base_url}`);
} else {
  console.error(`Cortex is not reachable at ${config.base_url}`);
  process.exit(1);
}
