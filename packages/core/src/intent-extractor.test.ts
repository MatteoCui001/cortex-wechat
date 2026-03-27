import { describe, expect, it } from "bun:test";
import { MessageHistory } from "./intent-extractor";

describe("MessageHistory", () => {
  it("keeps only maxSize entries", () => {
    const h = new MessageHistory(3, 10);
    h.push("a");
    h.push("b");
    h.push("c");
    h.push("d"); // should evict "a"
    // getContext returns all except last (current message)
    const ctx = h.getContext();
    expect(ctx).toContain("b");
    expect(ctx).toContain("c");
    expect(ctx).not.toContain("a");
    expect(ctx).not.toContain("d"); // d is current
  });

  it("returns empty string when only 1 message", () => {
    const h = new MessageHistory(5, 10);
    h.push("hello");
    expect(h.getContext()).toBe("");
  });

  it("returns empty string when buffer is empty", () => {
    const h = new MessageHistory(5, 10);
    expect(h.getContext()).toBe("");
  });

  it("includes prior messages as context", () => {
    const h = new MessageHistory(5, 10);
    h.push("https://mp.weixin.qq.com/s/abc123");
    h.push("这篇文章很有意思");
    const ctx = h.getContext();
    expect(ctx).toContain("mp.weixin.qq.com");
    expect(ctx).not.toContain("很有意思"); // current message excluded
  });
});
