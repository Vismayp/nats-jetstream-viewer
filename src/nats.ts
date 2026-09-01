import { jetstreamManager, type JetStreamManager, type StoredMsg } from "@nats-io/jetstream";
import { connect, credsAuthenticator, tokenAuthenticator, usernamePasswordAuthenticator, type NatsConnection, type NodeConnectionOptions } from "@nats-io/transport-node";
import type { AppConfig, DecoderConfig, ServerProfile } from "./types.js";
import { DecoderSandbox, type DecoderInput } from "./decoder.js";
import { ReadOnlyGatewayClient, type GatewayMessage } from "./gateway.js";

interface ManagedConnection {
  profile: ServerProfile;
  nc?: NatsConnection;
  jsm?: JetStreamManager;
  gateway?: ReadOnlyGatewayClient;
  status: "connecting" | "connected" | "disconnected" | "error";
  error?: string;
  connectedAt?: string;
}

interface StreamSummary {
  name: string; subjects: string[]; retention: string; storage: string; replicas: number;
  allowDirect: boolean; messages: number; bytes: number; firstSequence: number;
  lastSequence: number; consumerCount: number;
}

interface StreamInfoShape {
  stream: StreamSummary & Record<string, unknown>;
  consumers: unknown[];
}

function connectionOptions(profile: ServerProfile): NodeConnectionOptions {
  const opts: NodeConnectionOptions = {
    servers: profile.servers,
    name: `nats-jetstream-viewer:${profile.id}`,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2_000,
    timeout: 5_000,
  };
  if (profile.auth.type === "userpass") opts.authenticator = usernamePasswordAuthenticator(profile.auth.user, profile.auth.password);
  if (profile.auth.type === "token") opts.authenticator = tokenAuthenticator(profile.auth.token);
  if (profile.auth.type === "creds") opts.authenticator = credsAuthenticator(new TextEncoder().encode(profile.auth.creds));
  if (profile.tls) opts.tls = { ca: profile.tls.ca, cert: profile.tls.cert, key: profile.tls.key };
  return opts;
}

function headersOf(message: StoredMsg): Record<string, string[]> {
  return Object.fromEntries([...message.header].map(([key, values]) => [key, [...values]]));
}

function safeUtf8(data: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: false }).decode(data);
}

export class NatsManager {
  private readonly connections = new Map<string, ManagedConnection>();
  private decoders: DecoderConfig[] = [];
  private readonly sandbox = new DecoderSandbox();

  async reconcile(config: AppConfig) {
    this.decoders = config.decoders;
    const desired = new Set(config.profiles.filter((p) => p.enabled).map((p) => p.id));
    for (const [id, current] of this.connections) {
      const next = config.profiles.find((p) => p.id === id);
      if (!desired.has(id) || !next || JSON.stringify(next) !== JSON.stringify(current.profile)) await this.disconnect(id);
    }
    await Promise.allSettled(config.profiles.filter((p) => p.enabled && !this.connections.has(p.id)).map((p) => this.connect(p)));
  }

  private async connect(profile: ServerProfile) {
    const managed: ManagedConnection = { profile, status: "connecting" };
    this.connections.set(profile.id, managed);
    try {
      if ((profile.mode ?? "nats") === "gateway") {
        if (!profile.gateway) throw new Error("Gateway configuration is missing");
        managed.gateway = new ReadOnlyGatewayClient(profile.gateway);
        await managed.gateway.health();
        managed.status = "connected";
        managed.connectedAt = new Date().toISOString();
        return;
      }
      const nc = await connect(connectionOptions(profile));
      managed.nc = nc;
      managed.jsm = await jetstreamManager(nc);
      managed.status = "connected";
      managed.connectedAt = new Date().toISOString();
      void this.monitor(managed);
    } catch (error) {
      managed.status = "error";
      managed.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async monitor(managed: ManagedConnection) {
    if (!managed.nc) return;
    try {
      for await (const status of managed.nc.status()) {
        if (status.type === "disconnect") managed.status = "disconnected";
        if (status.type === "reconnect") { managed.status = "connected"; managed.error = undefined; }
        if (status.type === "error") managed.error = status.error.message;
      }
    } catch (error) { managed.status = "error"; managed.error = String(error); }
  }

  async disconnect(id: string) {
    const current = this.connections.get(id);
    this.connections.delete(id);
    if (current?.nc) await current.nc.drain().catch(() => current.nc?.close());
  }

  async close() { await Promise.allSettled([...this.connections.keys()].map((id) => this.disconnect(id))); }

  statuses() {
    return [...this.connections.values()].map((c) => ({
      id: c.profile.id, name: c.profile.name, mode: c.profile.mode ?? "nats", servers: c.profile.servers, status: c.status,
      connectedAt: c.connectedAt, error: c.error, server: c.nc?.getServer(),
      gateway: c.profile.gateway ? { url: c.profile.gateway.url, upstreamProfileId: c.profile.gateway.upstreamProfileId } : undefined,
    }));
  }

  private require(profileId: string) {
    const managed = this.connections.get(profileId);
    if (!managed || managed.status !== "connected" || (!managed.gateway && (!managed.jsm || !managed.nc))) throw new Error(`Profile '${profileId}' is not connected`);
    return managed;
  }

  async listStreams(profileId: string) {
    const { jsm, gateway } = this.require(profileId);
    if (gateway) return gateway.listStreams<StreamSummary[]>();
    const items = await jsm!.streams.list().next();
    return items.map((info) => ({
      name: info.config.name, subjects: info.config.subjects ?? [], retention: info.config.retention,
      storage: info.config.storage, replicas: info.config.num_replicas, allowDirect: info.config.allow_direct,
      messages: info.state.messages, bytes: info.state.bytes, firstSequence: info.state.first_seq,
      lastSequence: info.state.last_seq, consumerCount: info.state.consumer_count,
    }));
  }

  async streamInfo(profileId: string, stream: string) {
    const { jsm, gateway } = this.require(profileId);
    if (gateway) return gateway.streamInfo<StreamInfoShape>(stream);
    const info = await jsm!.streams.info(stream);
    const consumers = await jsm!.consumers.list(stream).next();
    return {
      stream: {
        name: info.config.name, subjects: info.config.subjects ?? [], retention: info.config.retention,
        storage: info.config.storage, replicas: info.config.num_replicas, allowDirect: info.config.allow_direct,
        maxAge: info.config.max_age, maxMessages: info.config.max_msgs, maxBytes: info.config.max_bytes,
        messages: info.state.messages, bytes: info.state.bytes, firstSequence: info.state.first_seq,
        lastSequence: info.state.last_seq, deleted: info.state.deleted ?? [],
      },
      consumers: consumers.map((c) => ({
        name: c.name, durableName: c.config.durable_name, ackPolicy: c.config.ack_policy,
        filterSubject: c.config.filter_subject, delivered: c.delivered, ackFloor: c.ack_floor,
        pending: c.num_pending, ackPending: c.num_ack_pending, redelivered: c.num_redelivered,
      })),
    };
  }

  async messages(profileId: string, stream: string, options: { start: number; limit: number; subject?: string; decode?: boolean }) {
    const { jsm, gateway } = this.require(profileId);
    if (gateway) {
      const page = await gateway.messages(stream, options);
      const decoder = options.decode ? this.decoders.find((d) => d.enabled && d.profileId === profileId && d.stream === stream) : undefined;
      const items = [];
      for (const message of page.items) items.push(await this.decorate(message, decoder));
      return { ...page, mode: "gateway", items };
    }
    const info = await jsm!.streams.info(stream);
    const limit = Math.min(Math.max(options.limit, 1), 200);
    const messages: StoredMsg[] = [];
    let mode: "direct" | "stream-get" = "stream-get";
    if (info.config.allow_direct) {
      try {
        mode = "direct";
        const iterator = await jsm!.direct.getBatch(stream, { seq: options.start, batch: limit, ...(options.subject ? { next_by_subj: options.subject } : {}) });
        for await (const message of iterator) messages.push(message);
      } catch {
        mode = "stream-get";
        await this.scanWithStreamGet(jsm!, stream, info.state.first_seq, info.state.last_seq, options, limit, messages);
      }
    } else {
      // Leader-consistent fallback. The scan cap prevents sparse streams from creating unbounded API load.
      await this.scanWithStreamGet(jsm!, stream, info.state.first_seq, info.state.last_seq, options, limit, messages);
    }
    const decoder = options.decode ? this.decoders.find((d) => d.enabled && d.profileId === profileId && d.stream === stream) : undefined;
    const output = [];
    for (const message of messages) output.push(await this.serialize(message, decoder));
    const last = messages.at(-1)?.seq;
    return { mode, items: output, nextSequence: last ? last + 1 : options.start, firstSequence: info.state.first_seq, lastSequence: info.state.last_seq };
  }

  private async scanWithStreamGet(jsm: JetStreamManager, stream: string, first: number, last: number, options: { start: number; subject?: string }, limit: number, messages: StoredMsg[]) {
    let seq = Math.max(options.start, first);
    const cap = Math.min(last, seq + Math.max(limit * 20, 1_000));
    while (seq <= cap && messages.length < limit) {
      const message = await jsm.streams.getMessage(stream, { seq }).catch(() => null);
      if (message && (!options.subject || subjectMatches(options.subject, message.subject))) messages.push(message);
      seq += 1;
    }
  }

  async message(profileId: string, stream: string, sequence: number, decode = true) {
    const { jsm, gateway } = this.require(profileId);
    if (gateway) {
      const message = await gateway.message(stream, sequence);
      if (!message) return null;
      const decoder = decode ? this.decoders.find((d) => d.enabled && d.profileId === profileId && d.stream === stream) : undefined;
      return this.decorate(message, decoder);
    }
    const message = await jsm!.streams.getMessage(stream, { seq: sequence });
    if (!message) return null;
    const decoder = decode ? this.decoders.find((d) => d.enabled && d.profileId === profileId && d.stream === stream) : undefined;
    return this.serialize(message, decoder);
  }

  private async serialize(message: StoredMsg, decoder?: DecoderConfig) {
    const headers = headersOf(message);
    const input: DecoderInput = {
      subject: message.subject, sequence: message.seq, timestamp: message.timestamp, headers,
      payload: { utf8: safeUtf8(message.data), base64: Buffer.from(message.data).toString("base64") },
    };
    return this.decorate({ ...input, size: message.data.byteLength }, decoder);
  }

  private async decorate(message: GatewayMessage, decoder?: DecoderConfig) {
    const input: DecoderInput = {
      subject: message.subject,
      sequence: message.sequence,
      timestamp: message.timestamp,
      headers: message.headers,
      payload: message.payload,
    };
    let decoded: unknown; let decoderError: string | undefined;
    if (decoder) {
      try { decoded = await this.sandbox.run(decoder.script, input); }
      catch (error) { decoderError = error instanceof Error ? error.message : String(error); }
    }
    return { ...input, size: message.size, decoded, decoder: decoder ? { id: decoder.id, name: decoder.name, error: decoderError } : undefined };
  }
}

function subjectMatches(filter: string, subject: string) {
  const f = filter.split("."); const s = subject.split(".");
  for (let i = 0; i < f.length; i += 1) {
    if (f[i] === ">") return true;
    if (f[i] !== "*" && f[i] !== s[i]) return false;
  }
  return f.length === s.length;
}
