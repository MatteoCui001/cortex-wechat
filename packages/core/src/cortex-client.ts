/**
 * Cortex REST API client — thin HTTP wrapper.
 */
import type { CortexConfig, NotificationSummary } from "./types";

export class CortexClient {
  private baseUrl: string;
  private workspace: string;
  private apiToken: string | undefined;

  constructor(config: CortexConfig) {
    this.baseUrl = config.base_url.replace(/\/$/, "");
    this.workspace = config.workspace;
    this.apiToken = config.api_token;
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
      body: n.body ?? "",
      priority: n.priority,
      source_kind: n.source_kind,
      signal_id: n.signal_id ?? "",
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
      return { ok: false, error: CortexClient.translateError((body as any).detail, res.status) };
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
      return { ok: false, error: CortexClient.translateError((data as any).detail, res.status) };
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
      return { ok: false, error: CortexClient.translateError((body as any).detail, res.status) };
    }
    return { ok: true };
  }

  /** GET /theses — list theses */
  async listTheses(status?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    const res = await this.get(`/theses?${params}`);
    if (!res.ok) return [];
    return res.json();
  }

  /** POST /theses/{id}/confirm */
  async confirmThesis(id: string): Promise<{ ok: boolean; error?: string }> {
    const res = await this.post(`/theses/${id}/confirm`, {});
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: CortexClient.translateError((data as any).detail, res.status) };
    }
    return { ok: true };
  }

  /** POST /theses/generate/{theme} */
  async generateTheses(theme: string): Promise<any[]> {
    const res = await this.post(`/theses/generate/${encodeURIComponent(theme)}`, {});
    if (!res.ok) return [];
    return res.json();
  }

  /** GET /theses/{id}/evidence */
  async getEvidence(thesisId: string, limit = 20): Promise<any[]> {
    const res = await this.get(`/theses/${thesisId}/evidence?limit=${limit}`);
    if (!res.ok) return [];
    return res.json();
  }

  /** POST /search */
  async search(query: string, limit = 10): Promise<any[]> {
    const res = await this.post("/search", { query, mode: "hybrid", limit });
    if (!res.ok) return [];
    return res.json();
  }

  /** GET /digest */
  async digest(days = 7): Promise<any> {
    const res = await this.get(`/digest?days=${days}`);
    if (!res.ok) return null;
    return res.json();
  }

  /** GET /stats */
  async stats(): Promise<any> {
    const res = await this.get("/stats");
    if (!res.ok) return null;
    return res.json();
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

  private static TIMEOUT_MS = 15_000;

  private authHeaders(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiToken) h["Authorization"] = `Bearer ${this.apiToken}`;
    return h;
  }

  private async get(path: string): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CortexClient.TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: this.authHeaders(),
        signal: ctrl.signal,
      });
      if (res.status === 401) {
        throw new Error("系统认证失败，请检查 API Token 配置");
      }
      return res;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error("处理超时，请稍后重试");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CortexClient.TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (res.status === 401) {
        throw new Error("系统认证失败，请检查 API Token 配置");
      }
      return res;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error("处理超时，请稍后重试");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private static translateError(detail: string | undefined, status: number): string {
    if (!detail) return `请求失败 (${status})`;
    // Common API error translations
    if (detail.includes("not found")) return "未找到该记录";
    if (detail.includes("Invalid transition")) return "操作无效（状态已变更）";
    if (detail.includes("already")) return "该操作已执行过";
    if (detail.includes("Unauthorized")) return "认证失败";
    return detail;
  }
}
