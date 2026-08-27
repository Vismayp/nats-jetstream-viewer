import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { Auth } from "./auth.js";
import { ConfigStore } from "./config.js";
import { NatsManager } from "./nats.js";

describe("SPA fallback", () => {
  const previousWebRoot = process.env.NJV_WEB_ROOT;
  const manager = new NatsManager();
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const directory = await mkdtemp(join(tmpdir(), "njv-app-"));
    process.env.NJV_WEB_ROOT = resolve("web");
    const store = new ConfigStore(
      join(directory, "config.enc"),
      randomBytes(32).toString("base64"),
    );
    await store.load();
    app = createApp(
      store,
      manager,
      new Auth(
        "a sufficiently long password",
        "a sufficiently long session secret for tests",
      ),
    );
  });

  afterAll(async () => {
    await manager.close();
    if (previousWebRoot === undefined) delete process.env.NJV_WEB_ROOT;
    else process.env.NJV_WEB_ROOT = previousWebRoot;
  });

  it.each(["/", "/connections", "/streams/WORK/messages"])(
    'serves the SPA shell for "%s"',
    async (path) => {
      const response = await request(app).get(path);
      expect(response.status).toBe(200);
      expect(response.text).toContain('<div id="root"></div>');
    },
  );

  it("keeps API routes available", async () => {
    await request(app).get("/api/health").expect(200, { ok: true });
  });
});
