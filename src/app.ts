import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { z } from "zod";
import { Auth, requireSameOrigin } from "./auth.js";
import { ConfigStore, profileSchema, publicProfile } from "./config.js";
import { DecoderSandbox } from "./decoder.js";
import { NatsManager } from "./nats.js";

const messageQuery = z.object({
  start: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  subject: z.string().min(1).max(255).optional(),
  decode: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
});

const decoderTestSchema = z.object({
  script: z.string().min(1).max(50_000),
  input: z.object({
    subject: z.string(), sequence: z.number(), timestamp: z.string(),
    headers: z.record(z.string(), z.array(z.string())),
    payload: z.object({ utf8: z.string(), base64: z.string() }),
  }),
});

export function createApp(store: ConfigStore, manager: NatsManager, auth: Auth) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'"] } } }));
  app.use(express.json({ limit: "256kb" }));
  app.use(requireSameOrigin);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/auth/session", (req, res) => res.json({ authenticated: auth.isAuthenticated(req) }));
  app.post("/api/auth/login", (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!auth.verifyPassword(password)) return res.status(401).json({ error: "Invalid credentials" });
    auth.issue(res); return res.json({ authenticated: true });
  });
  app.post("/api/auth/logout", (_req, res) => { auth.clear(res); res.json({ authenticated: false }); });

  app.use("/api", auth.require);
  app.get("/api/profiles", (_req, res) => res.json(store.snapshot().profiles.map(publicProfile)));
  app.post("/api/profiles", async (req, res) => {
    const profile = profileSchema.parse({ ...req.body, id: req.body?.id || randomUUID() });
    await store.upsertProfile(profile);
    await manager.reconcile(store.snapshot());
    res.status(201).json(publicProfile(profile));
  });
  app.delete("/api/profiles/:id", async (req, res) => {
    await manager.disconnect(req.params.id);
    await store.deleteProfile(req.params.id);
    res.status(204).end();
  });

  app.get("/api/connections", (_req, res) => res.json(manager.statuses()));
  app.post("/api/connections/reconcile", async (_req, res) => { await manager.reconcile(store.snapshot()); res.json(manager.statuses()); });
  app.get("/api/profiles/:profileId/streams", async (req, res) => res.json(await manager.listStreams(req.params.profileId)));
  app.get("/api/profiles/:profileId/streams/:stream", async (req, res) => res.json(await manager.streamInfo(req.params.profileId, req.params.stream)));
  app.get("/api/profiles/:profileId/streams/:stream/messages", async (req, res) => {
    const query = messageQuery.parse(req.query);
    res.json(await manager.messages(req.params.profileId, req.params.stream, query));
  });
  app.get("/api/profiles/:profileId/streams/:stream/messages/:sequence", async (req, res) => {
    const sequence = z.coerce.number().int().positive().parse(req.params.sequence);
    const message = await manager.message(req.params.profileId, req.params.stream, sequence, req.query.decode !== "false");
    if (!message) return res.status(404).json({ error: "Message is no longer stored" });
    return res.json(message);
  });

  app.get("/api/decoders", (_req, res) => res.json(store.snapshot().decoders));
  app.post("/api/decoders", async (req, res) => {
    const decoder = await store.upsertDecoder({ ...req.body, id: req.body?.id || randomUUID() });
    await manager.reconcile(store.snapshot());
    res.status(201).json(decoder);
  });
  app.delete("/api/decoders/:id", async (req, res) => {
    await store.deleteDecoder(req.params.id);
    await manager.reconcile(store.snapshot());
    res.status(204).end();
  });
  app.post("/api/decoders/test", async (req, res) => {
    const test = decoderTestSchema.parse(req.body);
    res.json({ output: await new DecoderSandbox().run(test.script, test.input) });
  });

  const dist = resolve(process.env.NJV_WEB_ROOT ?? "./dist");
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.get("/*splat", (_req, res) => res.sendFile(join(dist, "index.html")));

  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: error.issues });
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = /not connected|not found|stream not found/i.test(message) ? 503 : 500;
    if (process.env.NODE_ENV !== "test") console.error(error);
    return res.status(status).json({ error: message });
  };
  app.use(errors);
  return app;
}
