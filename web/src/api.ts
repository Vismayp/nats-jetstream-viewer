export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || response.statusText);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export interface Profile { id: string; name: string; mode: "nats" | "gateway"; servers: string[]; enabled: boolean; auth: { type: string; user?: string; configured: boolean }; tls: { configured: boolean; serverName?: string }; gateway?: { url: string; upstreamProfileId: string; tokenConfigured: boolean } }
export interface Connection { id: string; name: string; mode: "nats" | "gateway"; servers: string[]; status: string; connectedAt?: string; error?: string; server?: string; gateway?: { url: string; upstreamProfileId: string } }
export interface Stream { name: string; subjects: string[]; retention: string; storage: string; replicas: number; allowDirect: boolean; messages: number; bytes: number; firstSequence: number; lastSequence: number; consumerCount: number }
export interface StreamConsumer { name: string; durableName?: string; ackPolicy: string; filterSubject?: string; delivered: { consumer_seq: number; stream_seq: number }; ackFloor: { consumer_seq: number; stream_seq: number }; pending: number; ackPending: number; redelivered: number }
export interface StreamInfo { stream: Stream & { maxAge: number; maxMessages: number; maxBytes: number; deleted: number[] }; consumers: StreamConsumer[] }
export interface Message { subject: string; sequence: number; timestamp: string; headers: Record<string, string[]>; payload: { utf8: string; base64: string }; size: number; decoded?: unknown; decoder?: { id: string; name: string; error?: string } }
export interface Decoder { id: string; profileId: string; stream: string; name: string; script: string; enabled: boolean }
