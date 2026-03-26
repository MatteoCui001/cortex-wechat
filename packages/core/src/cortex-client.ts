/**
 * Cortex REST API client — thin HTTP wrapper.
 */
import type { CortexConfig, NotificationSummary } from "./types";

export class CortexClient {
  private baseUrl: string;
  private workspace: string;

  constructor(config: CortexConfig) {
    this.baseUrl = config.base_url.replace(/\/$/, "");
    this.workspace = config.workspace;
  }

  /** POST /events/ingest — submit text or URL */
  async ingest(opts: {
    content?: string;
    url?: string;
    title?: string;
    source?: string;
    user_annotation?: string;
  }): Promise<{ id: string; title: string; tags: string[] } | null> {
    const body: Record<string, string> = {
      source: opts.source ?? "wechat",
      workspace_id: this.workspace,
    };
    if (opts.url) body.url = opts.url;
    if (opts.content) body.content = opts.content;
    if (opts.title) body.title = opts.title;
    if (opts.user_annotation) body.user_annotation = opts.user_annotation;

    const res = await this.post("/events/ingest", body);
    if (!res.ok) return null;
    return res.json();
  }

  /** GET /notifications — list notifications */
  async getNotifications(
    status?: string,
    limit = 20,
    refresh = false,
  ): Promise<NotificationSummary[]> {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    params.set("limit", String(limit));
    if (refresh) params.set("refresh", "true");

    const res = await this.get(`/notifications?${params}`);
    if (!res.ok) return [];
    const items: any[] = await res.json();
    return items.map((n) => ({
      id: n.id,
      short_id: n.id.slice(0, 7),
      title: n.title,
      priority: n.priority,
      source_kind: n.source_kind,
      age: n.created_at ?? "",
    }));
  }

  /** POST /notifications/{id}/read|ack|dismiss */
  async transitionNotification(
    id: string,
    action: "read" | "ack" | "dismiss",
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await this.post(`/notifications/${id}/${action}`, {});
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body as any).detail ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  }

  /** POST /signals/{id}/feedback */
  async submitFeedback(
    signalId: string,
    verdict: string,
    note?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const body: Record<string, string> = { verdict };
    if (note) body.note = note;
    const res = await this.post(`/signals/${signalId}/feedback`, body);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: (data as any).detail ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  }

  /** GET /notifications — deliverable (pending) for push dispatch */
  async getDeliverableNotifications(limit = 10): Promise<NotificationSummary[]> {
    return this.getNotifications("pending", limit, false);
  }

  /** POST /notifications/{id}/deliver — mark as delivered via external channel */
  async deliverNotification(id: string): Promise<{ ok: boolean; error?: string }> {
    const res = await this.post(`/notifications/${id}/deliver`, {});
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body as any).detail ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  }

  /** GET /health */
  async health(): Promise<boolean> {
    try {
      const res = await this.get("/health");
      return res.ok;
    } catch {
      return false;
    }
  }

  // -- HTTP helpers --

  private async get(path: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}