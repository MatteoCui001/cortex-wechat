/**
 * Structured logger with categories for observability.
 */

export type LogCategory = "auth" | "poll" | "route" | "cortex_api" | "send" | "system";

const CATEGORY_WIDTH = 10;

export function log(category: LogCategory, msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  const cat = category.toUpperCase().padEnd(CATEGORY_WIDTH);
  console.log(`[${ts}] [${cat}] ${msg}`);
}

export function logError(category: LogCategory, msg: string, err?: unknown): void {
  const ts = new Date().toISOString().slice(11, 19);
  const cat = category.toUpperCase().padEnd(CATEGORY_WIDTH);
  const detail = err instanceof Error ? err.message : err ? String(err) : "";
  console.error(`[${ts}] [${cat}] ERROR: ${msg}${detail ? ` — ${detail}` : ""}`);
}
