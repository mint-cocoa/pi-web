import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { configuredAliases, validAlias } from "./protocol";
import { SshConnection } from "./transport";
import type { RemoteConnection, RemoteInventory, RemoteTranscript } from "./types";
import { serializeByKey } from "../key-serializer";

type Saved = Pick<RemoteConnection, "id" | "alias" | "label">;
interface Live { connection: RemoteConnection; transport?: SshConnection }
interface Registry { loaded: boolean; records: Map<string, Live> }
const STORE = Symbol.for("pi-web.remote-connections");
const LOCK = Symbol.for("pi-web.remote-connections-lock");
function registry(): Registry {
  const store = globalThis as Record<symbol, Registry | undefined>;
  return store[STORE] ??= { loaded: false, records: new Map() };
}
function configPath() {
  return join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "remote-connections.json");
}
export async function sshAliases(): Promise<string[]> {
  try { return configuredAliases(await readFile(join(homedir(), ".ssh", "config"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw new Error("Cannot read the Pi Web server's SSH config."); }
}
async function load() {
  const state = registry();
  if (state.loaded) return;
  let saved: Saved[] = [];
  let fresh = false;
  try {
    const parsed = JSON.parse(await readFile(configPath(), "utf8"));
    if (!Array.isArray(parsed) || parsed.length > 50 || parsed.some(item => !item || !validAlias(item.alias) || typeof item.label !== "string" || item.label.length > 80 || typeof item.id !== "string" || !/^[\w-]{1,64}$/.test(item.id))) {
      throw new Error("Invalid saved remote connection configuration.");
    }
    saved = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot read remote-connections.json. Repair the file before changing connections.");
    // Pre-register existing aliases, but do not connect at startup.
    const aliases = await sshAliases();
    saved = ["oracle", "cocoamini"].filter(alias => aliases.includes(alias)).map(alias => ({ id: randomUUID(), alias, label: alias }));
    fresh = true;
  }
  for (const item of saved) state.records.set(item.id, { connection: { id: item.id, alias: item.alias, label: item.label, state: "disconnected" } });
  try { if (fresh) await persist(); state.loaded = true; }
  catch { state.records.clear(); throw new Error("Cannot save remote-connections.json."); }
}
async function persist() {
  const path = configPath();
  await mkdir(join(path, ".."), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  const data = [...registry().records.values()].map(({ connection: { id, alias, label } }) => ({ id, alias, label }));
  await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}
function serialized<T>(task: () => Promise<T>) { return serializeByKey(LOCK, configPath(), async () => { await load(); return task(); }); }
function find(id: string): Live {
  const value = registry().records.get(id);
  if (!value) throw new Error("Remote connection was not found.");
  return value;
}
export async function listConnections() {
  return serialized(async () => ({ connections: [...registry().records.values()].map(value => ({ ...value.connection })), aliases: await sshAliases(), configPath: configPath() }));
}
export async function saveConnection(input: { id?: string; alias: string; label: string }) {
  return serialized(async () => {
    if (!validAlias(input.alias) || !(await sshAliases()).includes(input.alias)) throw new Error("Choose an explicit Host alias from the Pi Web server's ~/.ssh/config.");
    const label = input.label.trim();
    if (!label || label.length > 80 || /[\x00-\x1f]/.test(label)) throw new Error("Connection name must contain 1–80 printable characters.");
    const existing = input.id ? find(input.id) : undefined;
    if ([...registry().records.values()].some(value => value !== existing && value.connection.alias === input.alias)) throw new Error("This SSH alias is already registered.");
    if (!existing && registry().records.size >= 50) throw new Error("At most 50 connections can be registered.");
    const item: Live = { connection: { id: input.id || randomUUID(), label, alias: input.alias, state: "disconnected" } };
    const previous = existing;
    registry().records.set(item.connection.id, item);
    try { await persist(); } catch (error) {
      if (previous) registry().records.set(item.connection.id, previous); else registry().records.delete(item.connection.id);
      throw error;
    }
    previous?.transport?.close();
    return item.connection;
  });
}
export async function removeConnection(id: string) {
  return serialized(async () => {
    const item = find(id);
    registry().records.delete(id);
    try { await persist(); } catch (error) { registry().records.set(id, item); throw error; }
    item.transport?.close();
  });
}
export async function disconnectConnection(id: string) {
  return serialized(async () => {
    const item = find(id);
    item.transport?.close();
    item.transport = undefined;
    item.connection = { id: item.connection.id, label: item.connection.label, alias: item.connection.alias, state: "disconnected" };
    return item.connection;
  });
}
export async function connectConnection(id: string): Promise<RemoteConnection> {
  const item = await serialized(async () => {
    const item = find(id);
    if (item.connection.state === "connecting") throw new Error("Connection is already in progress.");
    if (item.connection.state === "connected") return item;
    if (!(await sshAliases()).includes(item.connection.alias)) throw new Error("This SSH alias is no longer configured on the Pi Web server.");
    item.connection.state = "connecting";
    item.connection.error = undefined;
    const transport = new SshConnection(item.connection.alias, error => {
      if (item.transport !== transport) return;
      item.transport = undefined;
      item.connection.state = error ? "error" : "disconnected";
      item.connection.error = error;
      item.connection.inventory = undefined;
    });
    item.transport = transport;
    return item;
  });
  await refreshItem(item);
  return { ...item.connection };
}
async function refreshItem(item: Live) {
  const transport = item.transport;
  if (!transport) throw new Error("Connect to this server first.");
  const inventory = await transport.request<RemoteInventory>("inventory");
  if (item.transport !== transport) throw new Error("Connection changed while the request was running.");
  item.connection.inventory = inventory;
  item.connection.checkedAt = new Date().toISOString();
  item.connection.state = "connected";
  item.connection.error = undefined;
}
export async function refreshConnection(id: string) {
  const item = await serialized(async () => find(id));
  await refreshItem(item);
  return { ...item.connection };
}
export async function readRemoteSession(id: string, sessionId: string) {
  const item = await serialized(async () => find(id));
  if (!/^[a-f0-9]{64}$/.test(sessionId) || !item.connection.inventory?.sessions.some(session => session.id === sessionId)) throw new Error("Session was not found in this connection.");
  if (!item.transport) throw new Error("Connect to this server first.");
  return item.transport.request<RemoteTranscript>("transcript", { sessionId });
}
