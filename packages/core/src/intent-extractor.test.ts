import { describe, expect, it } from "bun:test";
import { MessageHistory } from "./intent-extractor";

describe("MessageHistory", () => {
  it("keeps only maxSize entries per session", () => {
    const h = new MessageHistory(3, 10);
    const key = "session-1";
    h.push(key, "a");
    h.push(key, "b");
    h.push(key, "c");
    h.push(key, "d"); // should evict "a"
    const ctx = h.getContext(key);
    expect(ctx).toContain("b");
    expect(ctx).toContain("c");
    expect(ctx).not.toContain("a");
    expect(ctx).not.toContain("d"); // d is current
  });

  it("returns empty string when only 1 message in session", () => {
    const h = new MessageHistory(5, 10);
    h.push("s1", "hello");
    expect(h.getContext("s1")).toBe("");
  });

  it("returns empty string for unknown session", () => {
    const h = new MessageHistory(5, 10);
    expect(h.getContext("nonexistent")).toBe("");
  });

  it("includes prior messages as context", () => {
    const h = new MessageHistory(5, 10);
    const key = "s1";
    h.push(key, "https://mp.weixin.qq.com/s/abc123");
    h.push(key, "这篇文章很有意思");
    const ctx = h.getContext(key);
    expect(ctx).toContain("mp.weixin.qq.com");
    expect(ctx).not.toContain("很有意思"); // current message excluded
  });

  it("isolates different sessions", () => {
    const h = new MessageHistory(5, 10);
    h.push("user-A", "hello from A");
    h.push("user-A", "second from A");
    h.push("user-B", "hello from B");
    h.push("user-B", "second from B");

    const ctxA = h.getContext("user-A");
    const ctxB = h.getContext("user-B");

    expect(ctxA).toContain("hello from A");
    expect(ctxA).not.toContain("hello from B");
    expect(ctxB).toContain("hello from B");
    expect(ctxB).not.toContain("hello from A");
  });

  it("tracks session count", () => {
    const h = new MessageHistory(5, 10);
    h.push("s1", "a");
    h.push("s2", "b");
    h.push("s3", "c");
    expect(h.sessionCount).toBe(3);
  });

  it("gc evicts expired sessions", () => {
    const h = new MessageHistory(5, 0); // 0 minutes TTL = everything expires immediately
    h.push("s1", "a");
    h.gc();
    expect(h.sessionCount).toBe(0);
  });
});
