/**
 * [LEGACY] OpenClaw handler contract fixture tests.
 *
 * These tests verify that the stdin/stdout JSON contract is stable.
 * When the actual OpenClaw protocol is confirmed, these fixtures
 * prove whether the current handler needs changes.
 */
import { describe, expect, it, mock } from "bun:test";
import { CommandRouter, CortexClient } from "../../../packages/core/src/index";
import type { InboundMessage, OutboundReply } from "../../../packages/core/src/types";

// Fixture: what we expect OpenClaw to send us
const FIXTURES = {
  inbox: {
    input: { text: "收件箱", user_id: "wx_user_1", session_id: "s1", message_id: "m1" },
    expected_action: "inbox",
  },
  ingest_text: {
    input: { text: "今天聊了恒辉", user_id: "wx_user_1", session_id: "s1", message_id: "m2" },
    expected_action: "ingest",
  },
  ingest_url: {
    input: { text: "https://example.com/article", user_id: "wx_user_1", session_id: "s1", message_id: "m3" },
    expected_action: "ingest",
  },
  help: {
    input: { text: "帮助", user_id: "wx_user_1", session_id: "s1", message_id: "m4" },
    expected_action: "help",
  },
  ack: {
    input: { text: "确认 abc1234", user_id: "wx_user_1", session_id: "s1", message_id: "m5" },
    expected_action: "notification_ack",
  },
};

function makeMockClient() {
  return {
    ingest: mock(() => Promise.resolve({ id: "e1", title: "Test", tags: [] })),
    getNotifications: mock(() => Promise.resolve([{ id: "n1", short_id: "n1", title: "Test", body: "", priority: "medium", source_kind: "signal", signal_id: "", age: "" }])),
    transitionNotification: mock(() => Promise.resolve({ ok: true })),
    submitFeedback: mock(() => Promise.resolve({ ok: true })),
    health: mock(() => Promise.resolve(true)),
  } as unknown as CortexClient;
}

describe("OpenClaw contract fixtures", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`fixture: ${name} — input maps to action '${fixture.expected_action}'`, async () => {
      const client = makeMockClient();
      const router = new CommandRouter(client);

      // Convert fixture input to InboundMessage (what handler.ts does)
      const msg: InboundMessage = {
        session_id: fixture.input.session_id ?? "",
        user_id: fixture.input.user_id ?? "",
        message_id: fixture.input.message_id ?? "",
        text: fixture.input.text ?? "",
        platform: "openclaw",
      };

      const reply: OutboundReply = await router.route(msg);

      // Verify contract shape
      expect(reply).toHaveProperty("reply_text");
      expect(reply).toHaveProperty("actions_taken");
      expect(reply).toHaveProperty("pending_notifications");
      expect(reply).toHaveProperty("errors");

      // Verify expected action
      expect(reply.actions_taken).toContain(fixture.expected_action);

      // reply_text must be non-empty string
      expect(typeof reply.reply_text).toBe("string");
      expect(reply.reply_text.length).toBeGreaterThan(0);

      // arrays must be arrays
      expect(Array.isArray(reply.actions_taken)).toBe(true);
      expect(Array.isArray(reply.pending_notifications)).toBe(true);
      expect(Array.isArray(reply.errors)).toBe(true);
    });
  }

  it("output is valid JSON-serializable", async () => {
    const client = makeMockClient();
    const router = new CommandRouter(client);
    const msg: InboundMessage = {
      session_id: "s1", user_id: "u1", message_id: "m1",
      text: "帮助", platform: "openclaw",
    };
    const reply = await router.route(msg);

    // This is what handler.ts does: JSON.stringify the reply
    const json = JSON.stringify(reply);
    const parsed = JSON.parse(json);
    expect(parsed.reply_text).toBe(reply.reply_text);
    expect(parsed.actions_taken).toEqual(reply.actions_taken);
  });
});
