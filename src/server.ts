import { createServer } from "node:http";
import { Auth } from "./auth.js";
import { createApp } from "./app.js";
import { ConfigStore } from "./config.js";
import { NatsManager } from "./nats.js";

const port = Number(process.env.PORT ?? 3000);
const store = new ConfigStore();
await store.load();
const manager = new NatsManager();
await manager.reconcile(store.snapshot());
const auth = new Auth(process.env.NJV_ADMIN_PASSWORD ?? "", process.env.NJV_SESSION_SECRET ?? "");
const server = createServer(createApp(store, manager, auth));
server.listen(port, "0.0.0.0", () => console.log(`NATS JetStream Viewer listening on :${port}`));

async function shutdown() {
  server.close();
  await manager.close();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
