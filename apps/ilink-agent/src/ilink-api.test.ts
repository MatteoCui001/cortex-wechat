import { describe, expect, it } from "bun:test";
import { extractText, type ILinkMessage } from "./ilink-api";

function makeMsg(items: ILinkMessage["item_list"]): ILinkMessage {
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
