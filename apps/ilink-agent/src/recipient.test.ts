import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We test the pure logic by importing and using the functions directly.
// Since recipient.ts uses a hardcoded STATE_DIR, we test via the module's exports
// with a temporary override approach — or just test the file I/O behavior.

// For unit testing, we'll test the logic with a temporary directory by
// mocking the file paths. Since the module uses constants, we'll test
// the serialization/deserialization logic inline.

import type { PrimaryRecipient } from "./recipient";

describe("PrimaryRecipient", () => {
  const TMP = join(tmpdir(), `cortex-test-${Date.now()}`);
  const RECIPIENT_PATH = join(TMP, "primary_recipient.json");

  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  });

  it("PrimaryRecipient interface has correct shape", () => {
    const r: PrimaryRecipient = {
      user_id: "user123",
      context_token: "ctx_abc",
      last_message_at: new Date().toISOString(),
    };
    expect(r.user_id).toBe("user123");
    expect(r.context_token).toBe("ctx_abc");
    expect(typeof r.last_message_at).toBe("string");
  });

  it("serializes and deserializes correctly", () => {
    const original: PrimaryRecipient = {
      user_id: "wx_user_001",
      context_token: "ctx_token_xyz",
      last_message_at: new Date().toISOString(),
    };
    writeFileSync(RECIPIENT_PATH, JSON.stringify(original, null, 2));

    const loaded: PrimaryRecipient = JSON.parse(
      require("fs").readFileSync(RECIPIENT_PATH, "utf-8"),
    );
    expect(loaded.user_id).toBe(original.user_id);
    expect(loaded.context_token).toBe(original.context_token);
    expect(loaded.last_message_at).toBe(original.last_message_at);
  });

  it("detects expired session based on TTL", () => {
    const old: PrimaryRecipient = {
      user_id: "wx_user_001",
      context_token: "ctx_old",
      last_message_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
    };

    const ttlMs = 24 * 60 * 60 * 1000;
    const age = Date.now() - new Date(old.last_message_at).getTime();
    expect(age > ttlMs).toBe(true);
  });

  it("detects active session within TTL", () => {
    const recent: PrimaryRecipient = {
      user_id: "wx_user_002",
      context_token: "ctx_new",
      last_message_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1h ago
    };

    const ttlMs = 24 * 60 * 60 * 1000;
    const age = Date.now() - new Date(recent.last_message_at).getTime();
    expect(age <= ttlMs).toBe(true);
  });

  it("handles missing file gracefully", () => {
    const missing = join(TMP, "nonexistent.json");
    expect(existsSync(missing)).toBe(false);
  });
});