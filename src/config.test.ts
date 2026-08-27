import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConfigStore, publicProfile } from "./config.js";

describe("ConfigStore", () => {
  it("encrypts credentials at rest and reloads them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "njv-config-"));
    const path = join(dir, "config.enc"); const key = randomBytes(32).toString("base64");
    const store = new ConfigStore(path, key); await store.load();
    await store.upsertProfile({ id: "prod", name: "Production", servers: ["nats://localhost:4222"], enabled: true, auth: { type: "token", token: "very-secret-token" } });
    expect(await readFile(path, "utf8")).not.toContain("very-secret-token");
    const reloaded = new ConfigStore(path, key); await reloaded.load();
    expect(reloaded.snapshot().profiles[0]?.auth).toEqual({ type: "token", token: "very-secret-token" });
  });

  it("redacts credentials from API profiles", () => {
    const view = publicProfile({ id: "x", name: "X", servers: ["nats://x:4222"], enabled: true, auth: { type: "userpass", user: "reader", password: "hidden" } });
    expect(JSON.stringify(view)).not.toContain("hidden");
    expect(view.auth).toEqual({ type: "userpass", user: "reader", configured: true });
  });
});
