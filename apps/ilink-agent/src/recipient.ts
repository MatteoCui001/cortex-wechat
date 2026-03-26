/**
 * Primary recipient tracking — remembers who last messaged the bot
 * so we know where to push notifications.
 *
 * State persisted to ~/.cortex/wechat/primary_recipient.json
 *
 * Session TTL: 24 hours by default. After expiry, we cannot
 * proactively push (bot can only reply, not initiate).
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const STATE_DIR = join(homedir(), ".cortex", "wechat");
const RECIPIENT_PATH = join(STATE_DIR, "primary_recipient.json");

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface PrimaryRecipient {
  user_id: string;
  context_token: string;
  last_message_at: string; // ISO timestamp
}

/**
 * Load primary recipient from disk. Returns null if not found or expired.
 */
export function loadRecipient(ttlMs = DEFAULT_SESSION_TTL_MS): PrimaryRecipient | null {
  if (!existsSync(RECIPIENT_PATH)) return null;
  try {
    const data: PrimaryRecipient = JSON.parse(readFileSync(RECIPIENT_PATH, "utf-8"));
    const age = Date.now() - new Date(data.last_message_at).getTime();
    if (age > ttlMs) return null; // session expired
    return data;
  } catch {
    return null;
  }
}

/**
 * Save or update the primary recipient. Called on every inbound message.
 */
export function saveRecipient(userId: string, contextToken: string): void {
  const data: PrimaryRecipient = {
    user_id: userId,
    context_token: contextToken,
    last_message_at: new Date().toISOString(),
  };
  writeFileSync(RECIPIENT_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/**
 * Check if we have a valid (non-expired) recipient for push.
 */
export function hasActiveRecipient(ttlMs = DEFAULT_SESSION_TTL_MS): boolean {
  return loadRecipient(ttlMs) !== null;
}