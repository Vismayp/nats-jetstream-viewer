import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NatsManager } from "./nats.js";

describe("read-only HTTP gateway profiles", () => {
  const token = "gateway-token-that-is-at-least-32-bytes";
  const manager = new NatsManager();
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.statusCode = 401; res.end(JSON.stringify({ error: "unauthorized" })); return;
      }
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path === "/gateway/v1/health") {
        res.end(JSON.stringify({ ok: true, readOnly: true })); return;
      }
      if (path === "/gateway/v1/profiles/edge/streams") {
        res.end(JSON.stringify([{ name: "WORK", subjects: ["jobs.>"], retention: "workqueue", storage: "file", replicas: 1, allowDirect: true, messages: 1, bytes: 7, firstSequence: 1, lastSequence: 1, consumerCount: 1 }])); return;
      }
      if (path === "/gateway/v1/profiles/edge/streams/WORK/messages") {
        res.end(JSON.stringify({ mode: "direct", items: [message()], nextSequence: 2, firstSequence: 1, lastSequence: 1 })); return;
      }
      if (path === "/gateway/v1/profiles/edge/streams/WORK/messages/1") {
        res.end(JSON.stringify(message())); return;
      }
      res.statusCode = 404; res.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await manager.reconcile({
      profiles: [{ id: "remote", name: "Remote", mode: "gateway", servers: [], enabled: true, auth: { type: "none" }, gateway: { url, upstreamProfileId: "edge", token } }],
      decoders: [{ id: "json", profileId: "remote", stream: "WORK", name: "JSON", enabled: true, script: "function decode(input) { return JSON.parse(input.payload.utf8); }" }],
    });
  });

  afterAll(async () => {
    await manager.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("lists streams without opening a NATS connection", async () => {
    expect(await manager.listStreams("remote")).toEqual([expect.objectContaining({ name: "WORK", retention: "workqueue" })]);
    expect(manager.statuses()[0]).toEqual(expect.objectContaining({ mode: "gateway", status: "connected", gateway: { url, upstreamProfileId: "edge" } }));
  });

  it("reads gateway messages and applies local decoders", async () => {
    const page = await manager.messages("remote", "WORK", { start: 1, limit: 10, decode: true });
    expect(page.mode).toBe("gateway");
    expect(page.items[0]).toEqual(expect.objectContaining({ sequence: 1, decoded: { id: 1 } }));
    expect(await manager.message("remote", "WORK", 1, false)).toEqual(expect.objectContaining({ sequence: 1, decoded: undefined }));
  });
});

function message() {
  return { subject: "jobs.email", sequence: 1, timestamp: "2026-09-01T00:00:00.000Z", headers: {}, payload: { utf8: "{\"id\":1}", base64: "eyJpZCI6MX0=" }, size: 8 };
}
