import { describe, expect, it, mock } from "bun:test";
import { CommandRouter } from "./router";
import { CortexClient } from "./cortex-client";
import type { InboundMessage } from "./types";

// --- Mock CortexClient ---

function makeMockClient() {
  return {
    ingest: mock(() => Promise.resolve({ id: "evt-1", title: "Test Event", tags: ["ai"] })),
    getNotifications: mock(() =>
      Promise.resolve([
        { id: "notif-abc1234", short_id: "notif-a", title: "Signal detected", priority: "high", source_kind: "signal", age: "" },
      ]),
    ),
    transitionNotification: mock(() => Promise.resolve({ ok: true })),
    submitFeedback: mock(() => Promise.resolve({ ok: true })),
    health: mock(() => Promise.resolve(true)),
  } as unknown as CortexClient;
}

function makeMsg(text: string): InboundMessage {
  return {
    session_id: "s1",
    user_id: "u1",
    message_id: "m1",
    text,
    platform: "cli",
  };
}

describe("CommandRouter", () => {
  it("routes '帮助' to help text", async () => {
    const router = new CommandRouter(makeMockClient());
    const reply = await router.route(makeMsg("帮助"));
    expect(reply.actions_taken).toContain("help");
    expect(reply.reply_text).toContain("Cortex");
  });

  it("routes 'help' to help text", async () => {
    const router = new CommandRouter(makeMockClient());
    const reply = await router.route(makeMsg("help"));
    expect(reply.actions_taken).toContain("help");
  });

  it("routes '?' to help text", async () => {
    const router = new CommandRouter(makeMockClient());
    const reply = await router.route(makeMsg("?"));
    expect(reply.actions_taken).toContain("help");
  });

  it("routes '收件箱' to inbox", async () => {
    const client = makeMockClient();
    const router = new CommandRouter(client);
    const reply = await router.route(makeMsg("收件箱"));
    expect(reply.actions_taken).toContain("inbox");
    expect(reply.reply_text).toContain("收件箱");
    expect(client.getNotifications).toHaveBeenCalled();
  });

  it("routes 'inbox' to inbox", async () => {
    const router = new CommandRouter(makeMockClient());
    const reply = await router.route(makeMsg("inbox"));
    expect(reply.actions_taken).toContain("inbox");
  });

  it("routes '确认 abc1234' to ack transition", async () => {
    const client = makeMockClient();
    const router = new CommandRouter(client);
    const reply = await router.route(makeMsg("确认 abc1234"));
    expect(reply.actions_taken).toContain("notification_ack");
    expect(client.transitionNotification).toHaveBeenCalledWith("abc1234", "ack");
  });

  it("routes 'ack abc1234' to ack transition", async () => {
    const client = makeMockClient();
    const router = new CommandRouter(client);
    const reply = await router.route(makeMsg("ack abc1234"));
    expect(reply.actions_taken).toContain("notification_ack");
  });

  it("routes '已读 abc1234' to read transition", async () => {
    const client = makeMockClient();
    const router = new CommandRouter(client);
    const reply = await router.route(makeMsg("已读 abc1234"));
    expect(reply.actions_taken).toContain("notification_read");
    expect(client.transitionNotification).toHaveBeenCalledWith("abc1234", "read");
  });

  it("routes '忽略 abc1234' to dismiss transition", async () => {
    const client = makeMockClient();
    const router = new CommandRouter(client);
    const reply = await router.route(makeMsg("忽略 abc1234"));
    expect(reply.actions_taken).toContain("notification_dismiss");
  });

  it("routes '有用 sig-123' to feedback", async () => {
    const client = makeMockClient();
    const router = new CommandRouter(client);
    const reply = await router.route(makeMsg("有用 sig-123"));
    expect(reply.actions_taken).toContain("feedback");
    expect(client.submitFeedback).toHaveBeenCalledWith("sig-123", "useful");
  });

  it("routes URL to ingest with url", async () => {
    const client = makeMockClient();
    const router = new CommandRouter(client);
    const reply = await router.route(makeMsg("https://example.com/article"));
    expect(reply.actions_taken).toContain("ingest");
    expect(client.ingest).toHaveBeenCalled();
    // Check that URL was passed
    const callArgs = (client.ingest as any).mock.calls[0][0];
    expect(callArgs.url).toBe("https://example.com/article");
  });

  it("routes plain text to ingest as content", async () => {
    const client = makeMockClient();
    const router = new CommandRouter(client);
    const reply = await router.route(makeMsg("今天聊了恒辉，对 AI Agent 基础设施有新想法"));
    expect(reply.actions_taken).toContain("ingest");
    expect(reply.reply_text).toContain("已收录");
  });

  it("returns error text on ingest failure", async () => {
    const client = makeMockClient();
    (client.ingest as any).mockImplementation(() => Promise.resolve(null));
    const router = new CommandRouter(client);
    const reply = await router.route(makeMsg("some text"));
    expect(reply.reply_text).toContain("失败");
    expect(reply.errors).toContain("ingest_failed");
  });

  it("reports transition error", async () => {
    const client = makeMockClient();
    (client.transitionNotification as any).mockImplementation(() =>
      Promise.resolve({ ok: false, error: "not found" }),
    );
    const router = new CommandRouter(client);
    const reply = await router.route(makeMsg("确认 bad-id"));
    expect(reply.errors.length).toBeGreaterThan(0);
  });

  it("shows empty inbox message", async () => {
    const client = makeMockClient();
    (client.getNotifications as any).mockImplementation(() => Promise.resolve([]));
    const router = new CommandRouter(client);
    const reply = await router.route(makeMsg("收件箱"));
    expect(reply.reply_text).toContain("为空");
  });
});
