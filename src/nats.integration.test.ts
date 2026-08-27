import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AckPolicy, RetentionPolicy, StorageType, jetstream, jetstreamManager } from "@nats-io/jetstream";
import { connect, type NatsConnection } from "@nats-io/transport-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NatsManager } from "./nats.js";

const port = 14229;
const url = `nats://127.0.0.1:${port}`;
let server: ChildProcess; let nc: NatsConnection; const manager = new NatsManager();

async function waitForServer(child: ChildProcess) {
  await new Promise<void>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error("nats-server did not become ready")), 10_000);
    const ready = (chunk: Buffer) => { if (chunk.toString().includes("Server is ready")) { clearTimeout(timer); resolveReady(); } };
    child.stdout?.on("data", ready); child.stderr?.on("data", ready); child.once("exit", (code) => reject(new Error(`nats-server exited ${code}`)));
  });
}

beforeAll(async () => {
  const storage = await mkdtemp(join(tmpdir(), "njv-nats-"));
  const binary = resolve("node_modules/@eplightning/nats-server-linux-x64/bin/nats-server");
  server = spawn(binary, ["-js", "-p", String(port), "-sd", storage], { stdio: ["ignore", "pipe", "pipe"] });
  await waitForServer(server);
  nc = await connect({ servers: url });
  const jsm = await jetstreamManager(nc);
  await jsm.streams.add({ name: "WORK", subjects: ["jobs.>"], retention: RetentionPolicy.Workqueue, storage: StorageType.Memory, allow_direct: true });
  await jsm.consumers.add("WORK", { durable_name: "worker", ack_policy: AckPolicy.Explicit, filter_subject: "jobs.>" });
  const js = jetstream(nc); const codec = new TextEncoder();
  for (let i = 1; i <= 3; i += 1) await js.publish("jobs.email", codec.encode(JSON.stringify({ id: i })));
  await manager.reconcile({ profiles: [{ id: "test", name: "Test", servers: [url], enabled: true, auth: { type: "none" } }], decoders: [{ id: "json", profileId: "test", stream: "WORK", name: "JSON", enabled: true, script: "function decode(input) { return JSON.parse(input.payload.utf8); }" }] });
});

afterAll(async () => { await manager.close(); await nc?.close(); server?.kill("SIGTERM"); });

describe("WorkQueue read-only inspection", () => {
  it("reads stored messages without ACK, reservation, removal, or cursor movement", async () => {
    const jsm = await jetstreamManager(nc);
    const before = await jsm.streams.info("WORK");
    const consumerBefore = await jsm.consumers.info("WORK", "worker");
    const page = await manager.messages("test", "WORK", { start: 1, limit: 3, decode: true });
    const after = await jsm.streams.info("WORK");
    const consumerAfter = await jsm.consumers.info("WORK", "worker");
    expect(page.mode).toBe("direct");
    expect(page.items.map((m) => m.sequence)).toEqual([1, 2, 3]);
    expect(page.items[0]?.decoded).toEqual({ id: 1 });
    expect(after.state.messages).toBe(before.state.messages);
    expect(consumerAfter.num_pending).toBe(consumerBefore.num_pending);
    expect(consumerAfter.num_ack_pending).toBe(0);
    expect(consumerAfter.delivered.consumer_seq).toBe(consumerBefore.delivered.consumer_seq);
  });

  it("leaves the first message available to the real worker", async () => {
    const js = jetstream(nc); const consumer = await js.consumers.get("WORK", "worker");
    const message = await consumer.next({ expires: 2_000 });
    expect(message?.seq).toBe(1);
    message?.ack();
  });
});
