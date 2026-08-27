import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { AppConfig, PublicProfile, ServerProfile } from "./types.js";

const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("userpass"), user: z.string().min(1), password: z.string().min(1) }),
  z.object({ type: z.literal("token"), token: z.string().min(1) }),
  z.object({ type: z.literal("creds"), creds: z.string().min(1) }),
]);

export const profileSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  name: z.string().min(1).max(80),
  servers: z.array(z.string().regex(/^(nats|tls):\/\//).refine((value) => {
    try { const url = new URL(value); return !url.username && !url.password; } catch { return false; }
  }, "Credentials must use the authentication fields, not the server URL")).min(1).max(16),
  enabled: z.boolean().default(true),
  auth: authSchema,
  tls: z.object({ ca: z.string().optional(), cert: z.string().optional(), key: z.string().optional(), serverName: z.string().optional() }).optional(),
});

export const decoderSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  profileId: z.string().min(1),
  stream: z.string().min(1).max(255),
  name: z.string().min(1).max(80),
  script: z.string().min(1).max(50_000),
  enabled: z.boolean().default(true),
});

const configSchema = z.object({ profiles: z.array(profileSchema), decoders: z.array(decoderSchema) });
const EMPTY: AppConfig = { profiles: [], decoders: [] };

export class ConfigStore {
  private config: AppConfig = structuredClone(EMPTY);
  private readonly path: string;
  private readonly key: Buffer;

  constructor(path = process.env.NJV_DATA_FILE ?? "./data/config.enc", masterKey = process.env.NJV_MASTER_KEY ?? "") {
    this.path = resolve(path);
    const decoded = Buffer.from(masterKey, "base64");
    if (decoded.length !== 32) throw new Error("NJV_MASTER_KEY must be a base64-encoded 32-byte key");
    this.key = decoded;
  }

  async load() {
    try {
      const envelope = JSON.parse(await readFile(this.path, "utf8")) as { iv: string; tag: string; data: string };
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(envelope.iv, "base64"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const clear = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
      this.config = configSchema.parse(JSON.parse(clear.toString("utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.config = structuredClone(EMPTY);
    }
  }

  snapshot(): AppConfig { return structuredClone(this.config); }

  async upsertProfile(profile: ServerProfile) {
    const parsed = profileSchema.parse(profile);
    const i = this.config.profiles.findIndex((p) => p.id === parsed.id);
    if (i >= 0) this.config.profiles[i] = parsed; else this.config.profiles.push(parsed);
    await this.save();
  }

  async deleteProfile(id: string) {
    this.config.profiles = this.config.profiles.filter((p) => p.id !== id);
    this.config.decoders = this.config.decoders.filter((d) => d.profileId !== id);
    await this.save();
  }

  async upsertDecoder(input: unknown) {
    const decoder = decoderSchema.parse(input);
    const i = this.config.decoders.findIndex((d) => d.id === decoder.id);
    if (i >= 0) this.config.decoders[i] = decoder; else this.config.decoders.push(decoder);
    await this.save();
    return decoder;
  }

  async deleteDecoder(id: string) {
    this.config.decoders = this.config.decoders.filter((d) => d.id !== id);
    await this.save();
  }

  private async save() {
    await mkdir(dirname(this.path), { recursive: true });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(this.config)), cipher.final()]);
    const envelope = JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, envelope, { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

export function publicProfile(profile: ServerProfile): PublicProfile {
  return {
    id: profile.id,
    name: profile.name,
    servers: profile.servers,
    enabled: profile.enabled,
    auth: { type: profile.auth.type, user: profile.auth.type === "userpass" ? profile.auth.user : undefined, configured: profile.auth.type !== "none" },
    tls: { configured: Boolean(profile.tls?.ca || profile.tls?.cert || profile.tls?.key), serverName: profile.tls?.serverName },
  };
}
