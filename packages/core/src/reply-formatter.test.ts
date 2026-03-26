import { describe, expect, it } from "bun:test";
import { splitReply } from "./reply-formatter";

describe("splitReply", () => {
  it("returns single chunk for short text", () => {
    const chunks = splitReply("hello world");
    expect(chunks).toEqual(["hello world"]);
  });

  it("splits long text at paragraph boundaries", () => {
    const para = "a".repeat(1500);
    const text = `${para}\n\n${para}`;
    const chunks = splitReply(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(para);
    expect(chunks[1]).toBe(para);
  });

  it("splits single long paragraph by sentences", () => {
    const sentence = "这是一个测试句子。";
    const text = Array(300).fill(sentence).join("");
    const chunks = splitReply(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it("handles empty string", () => {
    expect(splitReply("")).toEqual([""]);
  });
});
