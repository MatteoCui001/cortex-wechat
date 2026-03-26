import { describe, expect, it } from "bun:test";
import { extractText, type ILinkMessage } from "./ilink-api";

function makeMsg(items: ILinkMessage["item_list"], overrides: Partial<ILinkMessage> = {}): ILinkMessage {
  return {
    seq: 1,
    message_id: 100,
    from_user_id: "wx_user",
    to_user_id: "wx_bot",
    client_id: "c1",
    create_time_ms: Date.now(),
    session_id: "s1",
    group_id: "",
    message_type: 1,
    message_state: 2,
    context_token: "tok",
    item_list: items,
    ...overrides,
  };
}

describe("extractText", () => {
  it("extracts text from text_item", () => {
    const msg = makeMsg([{ type: 1, text_item: { text: "hello" } }]);
    expect(extractText(msg)).toBe("hello");
  });

  it("returns empty for non-text items", () => {
    const msg = makeMsg([{ type: 2, image_item: {} }]);
    expect(extractText(msg)).toBe("");
  });

  it("returns first text item when multiple", () => {
    const msg = makeMsg([
      { type: 2, image_item: {} },
      { type: 1, text_item: { text: "second" } },
    ]);
    expect(extractText(msg)).toBe("second");
  });

  it("handles empty item_list", () => {
    const msg = makeMsg([]);
    expect(extractText(msg)).toBe("");
  });
});

describe("ILinkMessage structure", () => {
  it("bot messages have message_type 2", () => {
    const msg = makeMsg([{ type: 1, text_item: { text: "bot reply" } }], { message_type: 2 });
    expect(msg.message_type).toBe(2);
    // Bot messages should be skipped in handling — message_type 2 = bot
  });

  it("context_token is required for replies", () => {
    const msg = makeMsg([{ type: 1, text_item: { text: "hi" } }], { context_token: "abc123" });
    expect(msg.context_token).toBe("abc123");
    // Must echo this token in sendMessage
  });

  it("message_id can be used for dedup", () => {
    const msg1 = makeMsg([], { message_id: 42 });
    const msg2 = makeMsg([], { message_id: 42 });
    const seen = new Set<number>();
    seen.add(msg1.message_id);
    expect(seen.has(msg2.message_id)).toBe(true);
  });

  it("non-text message types are identifiable", () => {
    const imageMsg = makeMsg([{ type: 2, image_item: { url: "..." } }]);
    const voiceMsg = makeMsg([{ type: 3, voice_item: {} }]);
    const fileMsg = makeMsg([{ type: 4, file_item: {} }]);
    const videoMsg = makeMsg([{ type: 5, video_item: {} }]);

    expect(extractText(imageMsg)).toBe("");
    expect(extractText(voiceMsg)).toBe("");
    expect(extractText(fileMsg)).toBe("");
    expect(extractText(videoMsg)).toBe("");
  });
});
