/**
 * Shared environment-based configuration loaders.
 *
 * Centralizes the process.env → CortexConfig / LLMConfig pattern
 * so every adapter and skill script doesn't duplicate it.
 */
import type { CortexConfig, LLMConfig } from "./types";

/** Load CortexConfig from environment variables. */
export function loadConfig(): CortexConfig {
  return {
    base_url: process.env.CORTEX_BASE_URL ?? "http://127.0.0.1:8420/api/v1",
    workspace: process.env.CORTEX_WORKSPACE ?? "default",
    api_token: process.env.CORTEX_API_TOKEN,
  };
}

/**
 * Load LLMConfig from environment variables.
 * Returns undefined when LLM_BASE_URL or LLM_API_KEY is missing.
 */
export function loadLLMConfig(): LLMConfig | undefined {
  const base_url = process.env.LLM_BASE_URL;
  const api_key = process.env.LLM_API_KEY;
  if (!base_url || !api_key) return undefined;
  return {
    base_url,
    api_key,
    model: process.env.LLM_MODEL,
    timeout_ms: Number(process.env.LLM_TIMEOUT_MS) || 6000,
  };
}
