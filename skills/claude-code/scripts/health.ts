#!/usr/bin/env bun
/**
 * Cortex health check.
 */
import { CortexClient } from "../../../packages/core/src/cortex-client";
import type { CortexConfig } from "../../../packages/core/src/types";

const config: CortexConfig = {
  base_url: process.env.CORTEX_BASE_URL ?? "http://127.0.0.1:8420/api/v1",
  workspace: process.env.CORTEX_WORKSPACE ?? "default",
};

const client = new CortexClient(config);
const ok = await client.health();

if (ok) {
  console.log(`Cortex is healthy at ${config.base_url}`);
} else {
  console.error(`Cortex is not reachable at ${config.base_url}`);
  process.exit(1);
}
