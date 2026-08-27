import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AckPolicy, RetentionPolicy, StorageType, jetstream, jetstreamManager } from "@nats-io/jetstream";
import { connect, type NatsConnection } from "@nats-io/transport-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NatsManager } from "./nats.js";

const require = createRequire(import.meta.url);
const servers = [
  { port: 14229, url: "nats://127.0.0.1:14229", name: "workers" },
  { port: 14230, url: "nats://127.0.0.1:14230", name: "audit" },
] as const;
const packageForPlatform: Record<string, string> = {
  "darwin-arm64": "@eplightning/nats-server-darwin-arm64",
  "darwin-x64": "@eplightning/nats-server-darwin-x64",
  "linux-arm64": "@eplightning/nats-server-linux-arm64",
  "linux-x64": "@eplightning/nats-server-linux-x64",
  "win32-x64": "@eplightning/nats-server-win32-x64",
};

let workerServer: ChildProcess; let auditServer: ChildProcess;
let workerConnection: NatsConnection; let auditConnection: NatsConnection;
const manager = new NatsManager();

function natsServerBinary() {
  const packageName = packageForPlatform[`${process.platform}-${process.arch}`];
  if (!packageName) throw new Error(`No bundled NATS Server package for ${process.platform}-${process.arch}`);
  const binary = require(packageName) as { getBinaryPath: () => string };
  return binary.getBinaryPath();
}

async function waitForServer(child: ChildProcess) {
  await new Promise<void>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error("nats-server did not become ready")), 10_000);
    const ready = (chunk: Buffer) => { if (chunk.toString().includes("Server is ready")) { clearTimeout(timer); resolveReady(); } };
    child.stdout?.on("data", ready); child.stderr?.on("data", ready); child.once("exit", (code) => reject(new Error(`nats-server exited ${code}`)));
  });
}

beforeAll(async () => {
  const binary = natsServerBinary();
  const [workerStorage, auditStorage] = await Promise.all([
    mkdtemp(join(tmpdir(), "njv-nats-workers-")),
    mkdtemp(join(tmpdir(), "njv-nats-audit-")),
  ]);
  workerServer = spawn(binary, ["-js", "-p", String(servers[0].port), "-sd", workerStorage], { stdio: ["ignore", "pipe", "pipe"] });
  auditServer = spawn(binary, ["-js", "-p", String(servers[1].port), "-sd", auditStorage], { stdio: ["ignore", "pipe", "pipe"] });
  await Promise.all([waitForServer(workerServer), waitForServer(auditServer)]);

  workerConnection = await connect({ servers: servers[0].url });
  auditConnection = await connect({ servers: servers[1].url });
  const workerJsm = await jetstreamManager(workerConnection);
  const auditJsm = await jetstreamManager(auditConnection);
  await workerJsm.streams.add({ name: "WORK", subjects: ["jobs.>"], retention: RetentionPolicy.Workqueue, storage: StorageType.Memory, allow_direct: true });
  await workerJsm.consumers.add("WORK", { durable_name: "worker", ack_policy: AckPolicy.Explicit, filter_subject: "jobs.>" });
  await auditJsm.streams.add({ name: "AUDIT", subjects: ["audit.>"], retention: RetentionPolicy.Limits, storage: StorageType.Memory, allow_direct: false });

  const workerJs = jetstream(workerConnection); const auditJs = jetstream(auditConnection); const codec = new TextEncoder();
  for (let i = 1; i <= 3; i += 1) await workerJs.publish("jobs.email", codec.encode(JSON.stringify({ id: i })));
  await auditJs.publish("audit.created", codec.encode(JSON.stringify({ actor: "system", action: "created" })));
  await manager.reconcile({
    profiles: [
      { id: "workers", name: "Workers", servers: [servers[0].url], enabled: true, auth: { type: "none" } },
      { id: "audit", name: "Audit", servers: [servers[1].url], enabled: true, auth: { type: "none" } },
    ],
    decoders: [
      { id: "work-json", profileId: "workers", stream: "WORK", name: "Work JSON", enabled: true, script: "function decode(input) { return { kind: 'job', ...JSON.parse(input.payload.utf8) }; }" },
      { id: "audit-json", profileId: "audit", stream: "AUDIT", name: "Audit JSON", enabled: true, script: "function decode(input) { return { kind: 'audit', ...JSON.parse(input.payload.utf8) }; }" },
    ],
  });
});

afterAll(async () => {
  await manager.close();
  await workerConnection?.close(); await auditConnection?.close();
  workerServer?.kill("SIGTERM"); auditServer?.kill("SIGTERM");
});

describe("read-only inspection across NATS systems", () => {
  it("connects to multiple servers, observes streams with separate retention policies, and applies their own decoders", async () => {
    const workerJsm = await jetstreamManager(workerConnection);
    const auditJsm = await jetstreamManager(auditConnection);
    const workBefore = await workerJsm.streams.info("WORK");
    const consumerBefore = await workerJsm.consumers.info("WORK", "worker");
    const auditBefore = await auditJsm.streams.info("AUDIT");

    const [workPage, auditPage, workerStreams, auditStreams] = await Promise.all([
      manager.messages("workers", "WORK", { start: 1, limit: 3, decode: true }),
      manager.messages("audit", "AUDIT", { start: 1, limit: 3, decode: true }),
      manager.listStreams("workers"),
      manager.listStreams("audit"),
    ]);

    const workAfter = await workerJsm.streams.info("WORK");
    const consumerAfter = await workerJsm.consumers.info("WORK", "worker");
    const auditAfter = await auditJsm.streams.info("AUDIT");

    expect(manager.statuses().filter((status) => status.status === "connected")).toHaveLength(2);
    expect(workerStreams).toEqual(expect.arrayContaining([expect.objectContaining({ name: "WORK", retention: RetentionPolicy.Workqueue })]));
    expect(auditStreams).toEqual(expect.arrayContaining([expect.objectContaining({ name: "AUDIT", retention: RetentionPolicy.Limits })]));
    expect(workPage.mode).toBe("direct");
    expect(workPage.items.map((message) => message.sequence)).toEqual([1, 2, 3]);
    expect(workPage.items[0]?.decoded).toEqual({ kind: "job", id: 1 });
    expect(auditPage.mode).toBe("stream-get");
    expect(auditPage.items[0]?.decoded).toEqual({ kind: "audit", actor: "system", action: "created" });
    expect(workAfter.state.messages).toBe(workBefore.state.messages);
    expect(auditAfter.state.messages).toBe(auditBefore.state.messages);
    expect(consumerAfter.num_pending).toBe(consumerBefore.num_pending);
    expect(consumerAfter.num_ack_pending).toBe(0);
    expect(consumerAfter.delivered.consumer_seq).toBe(consumerBefore.delivered.consumer_seq);
  });

  it("leaves the first message available to the real worker", async () => {
    const js = jetstream(workerConnection); const consumer = await js.consumers.get("WORK", "worker");
    const message = await consumer.next({ expires: 2_000 });
    expect(message?.seq).toBe(1);
    message?.ack();
  });
});
