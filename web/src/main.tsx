import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  type Connection,
  type Decoder,
  type Message,
  type Profile,
  type Stream,
} from "./api";
import "./styles.css";

type Page = "messages" | "consumers" | "decoders" | "connections";

function useLoad<T>(path: string | null, deps: React.DependencyList = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const load = async () => {
    const currentRequest = ++requestId.current;
    if (!path) {
      setData(undefined);
      setError("");
      setLoading(false);
      return;
    }
    setData(undefined);
    setLoading(true);
    setError("");
    try {
      const next = await api<T>(path);
      if (currentRequest === requestId.current) setData(next);
    } catch (e) {
      if (currentRequest === requestId.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [path, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload: load };
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      onLogin();
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login-shell">
      <section className="login-card">
        <Logo />
        <div className="eyebrow">READ-ONLY OPERATIONS CONSOLE</div>
        <h1>
          See what is waiting.
          <br />
          <span>Touch nothing.</span>
        </h1>
        <p>
          Inspect stored JetStream messages across clusters without consumers,
          acknowledgements, or delivery side effects.
        </p>
        <form onSubmit={submit}>
          <label>
            Admin password
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter deployment password"
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button disabled={busy}>
            {busy ? "Opening…" : "Open console"}
            <i>→</i>
          </button>
        </form>
      </section>
      <div className="signal-grid" aria-hidden="true" />
    </main>
  );
}

function Logo() {
  return (
    <div className="logo">
      <span className="mark">N</span>
      <div>
        <b>NATS</b>
        <small>JETSTREAM VIEWER</small>
      </div>
    </div>
  );
}

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean>();
  useEffect(() => {
    api<{ authenticated: boolean }>("/auth/session")
      .then((r) => setAuthenticated(r.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);
  if (authenticated === undefined)
    return <div className="boot">Initializing console…</div>;
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return <Console onLogout={() => setAuthenticated(false)} />;
}

function Console({ onLogout }: { onLogout: () => void }) {
  const profiles = useLoad<Profile[]>("/profiles");
  const connections = useLoad<Connection[]>("/connections");
  const [profileId, setProfileId] = useState("");
  const [streamName, setStreamName] = useState("");
  const [page, setPage] = useState<Page>("messages");
  const [sessionError, setSessionError] = useState("");
  useEffect(() => {
    if (!profileId && profiles.data?.[0]) setProfileId(profiles.data[0].id);
  }, [profiles.data, profileId]);
  const streams = useLoad<Stream[]>(
    profileId ? `/profiles/${profileId}/streams` : null,
    [profileId],
  );
  useEffect(() => {
    if (streams.data && !streams.data.some((s) => s.name === streamName))
      setStreamName(streams.data[0]?.name ?? "");
  }, [streams.data, streamName]);
  const activeConnection = connections.data?.find((c) => c.id === profileId);
  const signOut = async () => {
    setSessionError("");
    try {
      await api("/auth/logout", { method: "POST" });
      onLogout();
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="app-shell">
      <aside>
        <Logo />
        <nav>
          {(["messages", "consumers", "decoders", "connections"] as Page[]).map(
            (item) => (
              <button
                key={item}
                className={page === item ? "active" : ""}
                onClick={() => setPage(item)}
              >
                <NavIcon item={item} />
                {item}
              </button>
            ),
          )}
        </nav>
        <div className="aside-bottom">
          <div className="safety">
            <span>SAFE MODE</span>
            <b>NO CONSUMER · NO ACK</b>
          </div>
          <button className="logout" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header>
          <div>
            <span className="breadcrumb">
              OPERATIONS / {page.toUpperCase()}
            </span>
            <h2>
              {page === "messages"
                ? "Stream messages"
                : page[0].toUpperCase() + page.slice(1)}
            </h2>
          </div>
          <div className="header-controls">
            <label>
              Connection
              <select
                value={profileId}
                onChange={(e) => {
                  setProfileId(e.target.value);
                  setStreamName("");
                }}
              >
                <option value="">Select connection</option>
                {profiles.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className={`status ${activeConnection?.status ?? "offline"}`}>
              <i />
              {activeConnection?.status ?? "offline"}
            </div>
          </div>
        </header>
        {(sessionError ||
          profiles.error ||
          connections.error ||
          streams.error) && (
          <div className="banner error">
            {sessionError ||
              profiles.error ||
              connections.error ||
              streams.error}
          </div>
        )}
        {page === "messages" && (
          <Messages
            profileId={profileId}
            streamName={streamName}
            setStreamName={setStreamName}
            streams={streams.data ?? []}
          />
        )}
        {page === "consumers" && (
          <Consumers
            profileId={profileId}
            streamName={streamName}
            setStreamName={setStreamName}
            streams={streams.data ?? []}
          />
        )}
        {page === "decoders" && (
          <Decoders profileId={profileId} streams={streams.data ?? []} />
        )}
        {page === "connections" && (
          <Connections
            profiles={profiles.data ?? []}
            connections={connections.data ?? []}
            reload={async () => {
              await profiles.reload();
              await connections.reload();
            }}
          />
        )}
      </div>
    </div>
  );
}

function NavIcon({ item }: { item: Page }) {
  const icons = {
    messages: "≋",
    consumers: "⇄",
    decoders: "{ }",
    connections: "⌘",
  };
  return <span>{icons[item]}</span>;
}

function StreamPicker({
  streams,
  value,
  onChange,
}: {
  streams: Stream[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="picker">
      Stream
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose stream</option>
        {streams.map((s) => (
          <option key={s.name}>{s.name}</option>
        ))}
      </select>
    </label>
  );
}

function Messages({
  profileId,
  streamName,
  setStreamName,
  streams,
}: {
  profileId: string;
  streamName: string;
  setStreamName: (v: string) => void;
  streams: Stream[];
}) {
  const [start, setStart] = useState(1);
  const [limit, setLimit] = useState(50);
  const [subject, setSubject] = useState("");
  const [selected, setSelected] = useState<Message>();
  const [refresh, setRefresh] = useState(0);
  const path =
    profileId && streamName
      ? `/profiles/${profileId}/streams/${encodeURIComponent(streamName)}/messages?start=${start}&limit=${limit}&decode=true${subject ? `&subject=${encodeURIComponent(subject)}` : ""}`
      : null;
  const messages = useLoad<{
    mode: string;
    items: Message[];
    nextSequence: number;
    firstSequence: number;
    lastSequence: number;
  }>(path, [refresh, profileId, streamName, start, limit, subject]);
  const stream = streams.find((s) => s.name === streamName);
  useEffect(() => {
    if (stream) setStart(stream.firstSequence || 1);
  }, [streamName]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setSelected(undefined), [profileId, streamName]);
  return (
    <main className="content">
      <section className="metric-row">
        <Metric
          label="STORED"
          value={stream?.messages.toLocaleString() ?? "—"}
        />
        <Metric label="FIRST SEQUENCE" value={stream?.firstSequence ?? "—"} />
        <Metric label="LAST SEQUENCE" value={stream?.lastSequence ?? "—"} />
        <Metric
          label="READ PATH"
          value={stream?.allowDirect ? "DIRECT GET" : "STREAM GET"}
          accent
        />
      </section>
      <section className="panel">
        <div className="toolbar">
          <StreamPicker
            streams={streams}
            value={streamName}
            onChange={setStreamName}
          />
          <label className="grow">
            Subject filter
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="jobs.* or exact subject"
            />
          </label>
          <label>
            Start sequence
            <input
              type="number"
              min="1"
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
            />
          </label>
          <label>
            Page size
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button className="refresh" onClick={() => setRefresh((v) => v + 1)}>
            ↻ Refresh
          </button>
        </div>
        <div className="read-only-note">
          <b>NON-CONSUMING READ</b>
          <span>
            This view cannot acknowledge, reserve, or remove messages.
          </span>
        </div>
        {messages.error && <div className="banner error">{messages.error}</div>}
        {messages.loading ? (
          <Loading />
        ) : (
          <MessageTable
            items={messages.data?.items ?? []}
            onSelect={setSelected}
          />
        )}
        <footer className="table-footer">
          <span>
            {messages.data?.items.length ?? 0} messages ·{" "}
            {messages.data?.mode ?? "—"}
          </span>
          <button
            disabled={!messages.data?.items.length}
            onClick={() => setStart(messages.data?.nextSequence ?? start)}
          >
            Next page →
          </button>
        </footer>
      </section>
      {selected && (
        <MessageDrawer
          message={selected}
          onClose={() => setSelected(undefined)}
        />
      )}
    </main>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className={`metric ${accent ? "accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Loading() {
  return (
    <div className="loading">
      <i />
      <span>Reading stream storage…</span>
    </div>
  );
}
function MessageTable({
  items,
  onSelect,
}: {
  items: Message[];
  onSelect: (m: Message) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Sequence</th>
            <th>Subject</th>
            <th>Received</th>
            <th>Size</th>
            <th>Decode</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.length ? (
            items.map((m) => (
              <tr key={m.sequence} onClick={() => onSelect(m)}>
                <td>
                  <code>#{m.sequence}</code>
                </td>
                <td>
                  <b>{m.subject}</b>
                </td>
                <td>{new Date(m.timestamp).toLocaleString()}</td>
                <td>{formatBytes(m.size)}</td>
                <td>
                  {m.decoder ? (
                    <span className={m.decoder.error ? "tag warn" : "tag"}>
                      {m.decoder.error ? "ERROR" : m.decoder.name}
                    </span>
                  ) : (
                    <span className="muted">Raw</span>
                  )}
                </td>
                <td>›</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6}>
                <div className="empty">No stored messages in this range</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function MessageDrawer({
  message,
  onClose,
}: {
  message: Message;
  onClose: () => void;
}) {
  const [view, setView] = useState<"decoded" | "json" | "raw" | "headers">(
    message.decoded !== undefined ? "decoded" : "json",
  );
  const json = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(message.payload.utf8), null, 2);
    } catch {
      return message.payload.utf8;
    }
  }, [message]);
  const content =
    view === "decoded"
      ? JSON.stringify(message.decoded, null, 2)
      : view === "json"
        ? json
        : view === "headers"
          ? JSON.stringify(message.headers, null, 2)
          : message.payload.base64;
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <span>MESSAGE #{message.sequence}</span>
            <h3>{message.subject}</h3>
          </div>
          <button onClick={onClose}>×</button>
        </div>
        <div className="drawer-meta">
          <span>{new Date(message.timestamp).toLocaleString()}</span>
          <span>{formatBytes(message.size)}</span>
        </div>
        <div className="tabs">
          {(["decoded", "json", "raw", "headers"] as const).map((v) => (
            <button
              key={v}
              disabled={v === "decoded" && message.decoded === undefined}
              className={view === v ? "active" : ""}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </div>
        {message.decoder?.error && (
          <div className="banner error">Decoder: {message.decoder.error}</div>
        )}
        <pre>{content}</pre>
      </aside>
    </div>
  );
}

function Consumers({
  profileId,
  streamName,
  setStreamName,
  streams,
}: {
  profileId: string;
  streamName: string;
  setStreamName: (v: string) => void;
  streams: Stream[];
}) {
  const info = useLoad<any>(
    profileId && streamName
      ? `/profiles/${profileId}/streams/${encodeURIComponent(streamName)}`
      : null,
    [profileId, streamName],
  );
  return (
    <main className="content">
      <section className="panel">
        <div className="toolbar">
          <StreamPicker
            streams={streams}
            value={streamName}
            onChange={setStreamName}
          />
          <button className="refresh" onClick={info.reload}>
            ↻ Refresh
          </button>
        </div>
        <div className="read-only-note">
          <b>METADATA ONLY</b>
          <span>
            Consumer Info is inspected; no message delivery is requested.
          </span>
        </div>
        {info.error && <div className="banner error">{info.error}</div>}
        {info.loading ? (
          <Loading />
        ) : (
          <div className="cards">
            {info.data?.consumers?.map((c: any) => (
              <article className="consumer" key={c.name}>
                <div>
                  <span>CONSUMER</span>
                  <h3>{c.name}</h3>
                </div>
                <div className="consumer-grid">
                  <Metric label="PENDING" value={c.pending} />
                  <Metric label="ACK PENDING" value={c.ackPending} />
                  <Metric label="REDELIVERED" value={c.redelivered} />
                  <Metric label="ACK POLICY" value={c.ackPolicy} />
                </div>
                <code>{c.filterSubject || ">"}</code>
              </article>
            ))}
            {info.data && !info.data.consumers.length && (
              <div className="empty">No consumers configured</div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function Decoders({
  profileId,
  streams,
}: {
  profileId: string;
  streams: Stream[];
}) {
  const decoders = useLoad<Decoder[]>("/decoders");
  const [editing, setEditing] = useState<Partial<Decoder>>();
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const save = async (d: Partial<Decoder>) => {
    setError("");
    await api("/decoders", { method: "POST", body: JSON.stringify(d) });
    await decoders.reload();
    setEditing(undefined);
  };
  const remove = async (d: Decoder) => {
    setError("");
    setBusyId(d.id);
    try {
      await api(`/decoders/${d.id}`, { method: "DELETE" });
      await decoders.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  };
  const toggle = async (d: Decoder) => {
    setError("");
    setBusyId(d.id);
    try {
      await save({ ...d, enabled: !d.enabled });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  };
  const visible =
    decoders.data?.filter((d) => !profileId || d.profileId === profileId) ?? [];
  return (
    <main className="content">
      <section className="panel">
        <div className="section-head">
          <div>
            <span>CUSTOM UNMARSHALLING</span>
            <h3>Stream decoders</h3>
          </div>
          <button
            className="primary"
            disabled={!profileId || !streams.length}
            title={!profileId ? "Select a connection first" : undefined}
            onClick={() =>
              setEditing({
                profileId,
                stream: streams[0]?.name,
                name: "JSON decoder",
                enabled: true,
                script: DEFAULT_SCRIPT,
              })
            }
          >
            + New decoder
          </button>
        </div>
        <div className="read-only-note">
          <b>SANDBOXED QUICKJS</b>
          <span>
            No network, filesystem, process, environment, or NATS access.
          </span>
        </div>
        {(error || decoders.error) && (
          <div className="banner error">{error || decoders.error}</div>
        )}
        <div className="decoder-list">
          {visible.map((d) => (
            <article key={d.id}>
              <div>
                <i className={d.enabled ? "on" : ""} />
                <div>
                  <b>{d.name}</b>
                  <span>{d.stream}</span>
                </div>
              </div>
              <div>
                <button
                  disabled={busyId === d.id}
                  onClick={() => void toggle(d)}
                >
                  {d.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  disabled={busyId === d.id}
                  onClick={() => setEditing(d)}
                >
                  Edit
                </button>
                <button
                  className="danger"
                  disabled={busyId === d.id}
                  onClick={() => void remove(d)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
          {!decoders.loading && !visible.length && (
            <div className="empty">
              No decoders configured for this connection
            </div>
          )}
        </div>
      </section>
      {editing && (
        <DecoderEditor
          value={editing}
          streams={streams}
          onClose={() => setEditing(undefined)}
          onSave={save}
        />
      )}
    </main>
  );
}

const DEFAULT_SCRIPT = `function decode(input) {\n  // Return any JSON-serializable value.\n  return JSON.parse(input.payload.utf8);\n}`;
function DecoderEditor({
  value,
  streams,
  onClose,
  onSave,
}: {
  value: Partial<Decoder>;
  streams: Stream[];
  onClose: () => void;
  onSave: (d: Partial<Decoder>) => Promise<void>;
}) {
  const [form, setForm] = useState(value);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const test = async () => {
    try {
      const r = await api<{ output: unknown }>("/decoders/test", {
        method: "POST",
        body: JSON.stringify({
          script: form.script,
          input: {
            subject: "jobs.demo",
            sequence: 42,
            timestamp: new Date().toISOString(),
            headers: { "Content-Type": ["application/json"] },
            payload: {
              utf8: '{"status":"queued","attempt":1}',
              base64: "eyJzdGF0dXMiOiJxdWV1ZWQiLCJhdHRlbXB0IjoxfQ==",
            },
          },
        }),
      });
      setResult(JSON.stringify(r.output, null, 2));
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    }
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Decoder editor"
      >
        <div className="section-head">
          <div>
            <span>DECODER EDITOR</span>
            <h3>{value.id ? "Edit decoder" : "New decoder"}</h3>
          </div>
          <button aria-label="Close decoder editor" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="form-grid">
          <label>
            Name
            <input
              value={form.name ?? ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Stream
            <select
              value={form.stream ?? ""}
              onChange={(e) => setForm({ ...form, stream: e.target.value })}
            >
              {streams.map((s) => (
                <option key={s.name}>{s.name}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          JavaScript
          <textarea
            spellCheck={false}
            value={form.script ?? ""}
            onChange={(e) => setForm({ ...form, script: e.target.value })}
          />
        </label>
        {error && <div className="banner error">{error}</div>}
        {result && <pre className="test-output">{result}</pre>}
        <footer>
          <button disabled={busy} onClick={() => void test()}>
            Run with sample
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : "Save decoder"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function Connections({
  profiles,
  connections,
  reload,
}: {
  profiles: Profile[];
  connections: Connection[];
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState("");
  const remove = async (profile: Profile) => {
    if (!window.confirm(`Delete ${profile.name}?`)) return;
    setError("");
    setDeleting(profile.id);
    try {
      await api(`/profiles/${profile.id}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting("");
    }
  };
  return (
    <main className="content">
      <section className="panel">
        <div className="section-head">
          <div>
            <span>MULTI-SERVER GATEWAY</span>
            <h3>Connections</h3>
          </div>
          <button className="primary" onClick={() => setEditing(true)}>
            + Add connection
          </button>
        </div>
        {error && <div className="banner error">{error}</div>}
        <div className="connection-list">
          {profiles.map((p) => {
            const c = connections.find((x) => x.id === p.id);
            const tls = p.tls.configured
              ? "TLS credentials configured"
              : p.servers.some((server) => server.startsWith("tls://"))
                ? "TLS"
                : "No TLS";
            return (
              <article key={p.id}>
                <div className={`connection-icon ${c?.status}`}>
                  <i />
                </div>
                <div className="connection-main">
                  <b>{p.name}</b>
                  <span>{p.servers.join(", ")}</span>
                </div>
                <span className={`tag ${c?.status === "error" ? "warn" : ""}`}>
                  {c?.status ?? "disabled"}
                </span>
                <small>
                  {p.auth.type} · {tls}
                </small>
                <button
                  className="danger"
                  disabled={deleting === p.id}
                  onClick={() => void remove(p)}
                >
                  {deleting === p.id ? "Deleting…" : "Delete"}
                </button>
              </article>
            );
          })}
          {!profiles.length && (
            <div className="empty">No connections configured</div>
          )}
        </div>
      </section>
      {editing && (
        <ConnectionEditor
          onClose={() => setEditing(false)}
          onSave={async (d) => {
            await api("/profiles", { method: "POST", body: JSON.stringify(d) });
            await reload();
            setEditing(false);
          }}
        />
      )}
    </main>
  );
}

function ConnectionEditor({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (v: unknown) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [servers, setServers] = useState("nats://localhost:4222");
  const [authType, setAuthType] = useState("none");
  const [user, setUser] = useState("");
  const [secret, setSecret] = useState("");
  const [tlsServerName, setTlsServerName] = useState("");
  const [tlsCa, setTlsCa] = useState("");
  const [tlsCert, setTlsCert] = useState("");
  const [tlsKey, setTlsKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const auth =
      authType === "userpass"
        ? { type: authType, user, password: secret }
        : authType === "token"
          ? { type: authType, token: secret }
          : authType === "creds"
            ? { type: authType, creds: secret }
            : { type: "none" };
    const tls = {
      ...(tlsServerName ? { serverName: tlsServerName } : {}),
      ...(tlsCa ? { ca: tlsCa } : {}),
      ...(tlsCert ? { cert: tlsCert } : {}),
      ...(tlsKey ? { key: tlsKey } : {}),
    };
    setBusy(true);
    setError("");
    try {
      await onSave({
        name,
        servers: servers
          .split(/[,\n]/)
          .map((x) => x.trim())
          .filter(Boolean),
        enabled: true,
        auth,
        ...(Object.keys(tls).length ? { tls } : {}),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="modal compact"
        role="dialog"
        aria-modal="true"
        aria-label="Add NATS system"
      >
        <div className="section-head">
          <div>
            <span>CONNECTION PROFILE</span>
            <h3>Add NATS system</h3>
          </div>
          <button aria-label="Close connection editor" onClick={onClose}>
            ×
          </button>
        </div>
        <label>
          Display name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production India"
          />
        </label>
        <label>
          Seed URLs
          <textarea
            className="short"
            value={servers}
            onChange={(e) => setServers(e.target.value)}
          />
          <small>Comma or newline separated URLs in the same cluster.</small>
        </label>
        <label>
          Authentication
          <select
            value={authType}
            onChange={(e) => setAuthType(e.target.value)}
          >
            <option value="none">None</option>
            <option value="userpass">Username + password</option>
            <option value="token">Token</option>
            <option value="creds">NATS .creds contents</option>
          </select>
        </label>
        {authType === "userpass" && (
          <label>
            Username
            <input value={user} onChange={(e) => setUser(e.target.value)} />
          </label>
        )}
        {authType !== "none" && (
          <label>
            {authType === "creds" ? "Credentials file contents" : "Secret"}
            <textarea
              className="short"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
        )}
        <details className="tls-fields">
          <summary>TLS options</summary>
          <label>
            Server name
            <input
              value={tlsServerName}
              onChange={(e) => setTlsServerName(e.target.value)}
              placeholder="nats.example.internal"
            />
          </label>
          <label>
            CA certificate
            <textarea
              className="short"
              value={tlsCa}
              onChange={(e) => setTlsCa(e.target.value)}
            />
          </label>
          <label>
            Client certificate
            <textarea
              className="short"
              value={tlsCert}
              onChange={(e) => setTlsCert(e.target.value)}
            />
          </label>
          <label>
            Client private key
            <textarea
              className="short"
              value={tlsKey}
              onChange={(e) => setTlsKey(e.target.value)}
            />
          </label>
        </details>
        {error && <div className="banner error">{error}</div>}
        <footer>
          <button disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Connecting…" : "Save & connect"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
