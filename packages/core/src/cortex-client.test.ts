import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { CortexClient } from "./cortex-client";

// Mock fetch globally for these tests
const originalFetch = globalThis.fetch;

describe("CortexClient", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeClient() {
    return new CortexClient({
      base_url: "http://localhost:8420/api/v1",
      workspace: "default",
    });
  }

  describe("deliverNotification", () => {
    it("returns ok on 200 response", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ status: "delivered" }), { status: 200 })),
      ) as any;

      const client = makeClient();
      const result = await client.deliverNotification("notif-123");
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("returns error on 404 response", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ detail: "Not found" }), { status: 404 })),
      ) as any;

      const client = makeClient();
      const result = await client.deliverNotification("bad-id");
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Not found");
    });

    it("returns error on 409 response", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: "Invalid transition" }), { status: 409 }),
        ),
      ) as any;

      const client = makeClient();
      const result = await client.deliverNotification("already-delivered");
      expect(result.ok).toBe(false);
      expect(result.error).toBe("操作无效（状态已变更）");
    });

    it("posts to correct URL", async () => {
      let capturedUrl = "";
      globalThis.fetch = mock((url: string) => {
        capturedUrl = url;
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as any;

      const client = makeClient();
      await client.deliverNotification("abc-def-ghi");
      expect(capturedUrl).toBe("http://localhost:8420/api/v1/notifications/abc-def-ghi/deliver");
    });
  });

  describe("getDeliverableNotifications", () => {
    it("returns pending notifications", async () => {
      const notifications = [
        { id: "n1-full-uuid", title: "Signal A", priority: "high", source_kind: "signal", created_at: "2026-03-26" },
        { id: "n2-full-uuid", title: "Signal B", priority: "medium", source_kind: "thesis_stale", created_at: "2026-03-25" },
      ];
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(notifications), { status: 200 })),
      ) as any;

      const client = makeClient();
      const result = await client.getDeliverableNotifications(5);
      expect(result).toHaveLength(2);
      expect(result[0].short_id).toBe("n1-full");
      expect(result[0].priority).toBe("high");
    });

    it("passes status=pending query param", async () => {
      let capturedUrl = "";
      globalThis.fetch = mock((url: string) => {
        capturedUrl = url;
        return Promise.resolve(new Response("[]", { status: 200 }));
      }) as any;

      const client = makeClient();
      await client.getDeliverableNotifications(10);
      expect(capturedUrl).toContain("status=pending");
      expect(capturedUrl).toContain("limit=10");
    });

    it("returns empty array on error", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("Internal error", { status: 500 })),
      ) as any;

      const client = makeClient();
      const result = await client.getDeliverableNotifications();
      expect(result).toEqual([]);
    });
  });

  describe("health", () => {
    it("returns true on 200", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("{}", { status: 200 })),
      ) as any;

      const client = makeClient();
      expect(await client.health()).toBe(true);
    });

    it("returns false on network error", async () => {
      globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED"))) as any;

      const client = makeClient();
      expect(await client.health()).toBe(false);
    });
  });

  describe("transitionNotification", () => {
    it("posts to correct action URL", async () => {
      let capturedUrl = "";
      globalThis.fetch = mock((url: string) => {
        capturedUrl = url;
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as any;

      const client = makeClient();
      await client.transitionNotification("n123", "ack");
      expect(capturedUrl).toBe("http://localhost:8420/api/v1/notifications/n123/ack");
    });
  });
});
