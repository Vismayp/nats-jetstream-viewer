import type { GatewayConfig } from "./types.js";

export interface GatewayMessage {
  subject: string;
  sequence: number;
  timestamp: string;
  headers: Record<string, string[]>;
  payload: { utf8: string; base64: string };
  size: number;
}

export interface GatewayMessagePage {
  mode: string;
  items: GatewayMessage[];
  nextSequence: number;
  firstSequence: number;
  lastSequence: number;
}

export class ReadOnlyGatewayClient {
  private readonly baseUrl: URL;

  constructor(private readonly config: GatewayConfig) {
    this.baseUrl = new URL(config.url.endsWith("/") ? config.url : `${config.url}/`);
  }

  async health() {
    await this.request("gateway/v1/health");
  }

  listStreams<T>() {
    return this.request<T>(this.profilePath("streams"));
  }

  streamInfo<T>(stream: string) {
    return this.request<T>(this.profilePath(`streams/${encodeURIComponent(stream)}`));
  }

  messages(stream: string, options: { start: number; limit: number; subject?: string }) {
    const query = new URLSearchParams({ start: String(options.start), limit: String(options.limit) });
    if (options.subject) query.set("subject", options.subject);
    return this.request<GatewayMessagePage>(
      `${this.profilePath(`streams/${encodeURIComponent(stream)}/messages`)}?${query}`,
    );
  }

  async message(stream: string, sequence: number) {
    return this.request<GatewayMessage>(
      this.profilePath(`streams/${encodeURIComponent(stream)}/messages/${sequence}`),
      true,
    );
  }

  private profilePath(suffix: string) {
    return `gateway/v1/profiles/${encodeURIComponent(this.config.upstreamProfileId)}/${suffix}`;
  }

  private request<T = unknown>(path: string): Promise<T>;
  private request<T = unknown>(path: string, notFoundIsNull: true): Promise<T | null>;
  private async request<T = unknown>(path: string, notFoundIsNull = false): Promise<T | null> {
    const response = await fetch(new URL(path, this.baseUrl), {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.config.token}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (notFoundIsNull && response.status === 404) return null;
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(`Read-only gateway returned ${response.status}: ${body.error ?? response.statusText}`);
    }
    return response.json() as Promise<T>;
  }
}
