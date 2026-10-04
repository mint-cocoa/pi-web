import { hostname, homedir, userInfo } from "node:os";
import { statSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { projectTrustReloadOptions } from "../project-trust";
import { resolveVisibleModels } from "../model-scope";
import { registeredConnection } from "../connections/manager";
import { serializeByKey } from "../key-serializer";
import { getRpcSession, startRpcSession } from "../rpc-manager";
import { resolveSessionPath, listAllSessions, invalidateSessionListCache, buildSessionContext } from "../session-reader";
import { normalizeToolCalls, normalizeStreamingToolCalls } from "../normalize";
import { sessionRefKey, type SessionRef } from "../session-provider";
import type { AgentMessage } from "../types";
import { GatewayClient } from "./ssh-client";
import { approvalRecord, codexDelta, codexMessages, piRequest } from "./normalize";
import type { RuntimeAnswer, RuntimeSnapshot, RuntimeSessionSummary, RuntimeTarget } from "./types";
import { createExecutionProvider } from "./provider";

interface Entry { snapshot: RuntimeSnapshot; listeners: Set<(snapshot: RuntimeSnapshot) => void>; source: "local" | "gateway"; client?: GatewayClient; unsubscribe?: () => void; streamItem?: string; streaming?: boolean }
interface Store { epoch: string; entries: Map<string, Entry>; clients: Map<string, GatewayClient>; creates: Map<string, { fingerprint: string; result: RuntimeSnapshot }>; cursors: Map<string, number>; polling: Set<string>; timer?: ReturnType<typeof setInterval> }
const STORE = Symbol.for("pi-web.session-runtime"); const LOCK = Symbol.for("pi-web.runtime-lock");
function store(): Store { const global = globalThis as Record<symbol, Store | undefined>; return global[STORE] ??= { epoch: randomUUID(), entries: new Map(), clients: new Map(), creates: new Map(), cursors: new Map(), polling: new Set() }; }
function validTarget(target: RuntimeTarget) { if (!target || typeof target.connectionId !== "string" || !["pi", "codex"].includes(target.backend)) throw new Error("Invalid runtime target."); }
function validRef(ref: SessionRef) { validTarget(ref); if (typeof ref.id !== "string" || !ref.id || ref.id.length > 200 || /[\\/\r\n\0]/.test(ref.id)) throw new Error("Invalid session reference."); }
function plain(snapshot: RuntimeSnapshot): RuntimeSnapshot { return JSON.parse(JSON.stringify(snapshot)); }
function emit(entry: Entry) { entry.snapshot.cursor++; const snapshot = plain(entry.snapshot); for (const listener of entry.listeners) listener(snapshot); }
async function gateway(target: RuntimeTarget) {
  validTarget(target);
  const saved = target.connectionId === "local" ? undefined : await registeredConnection(target.connectionId);
  const key = `${target.connectionId}:${saved?.alias || "local"}`;
  let client = store().clients.get(key);
  if (!client?.alive) { client = new GatewayClient(saved?.alias); store().clients.set(key, client); }
  return client;
}
async function localPi(target: RuntimeTarget) {
  if (target.backend !== "pi") return false;
  if (target.connectionId === "local") return true;
  const info = await (await gateway(target)).request<{ hostname: string; user: string; bootId?: string }>("pi", "info");
  let bootId: string;
  try { bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(); } catch { return false; }
  return Boolean(bootId) && info.bootId === bootId && info.hostname === hostname() && info.user === userInfo().username;
}
function piMessages(wrapper: NonNullable<ReturnType<typeof getRpcSession>>): AgentMessage[] {
  const manager = wrapper.inner.sessionManager;
  const raw = buildSessionContext(manager.getEntries() as never, manager.getLeafId(), { tail: 400 }).messages;
  const messages = raw.filter(message => ["user", "assistant", "toolResult", "bashExecution", "custom"].includes(message.role)).slice(-400).map(normalizeToolCalls);
  if (wrapper.streamingMessage) messages.push(normalizeStreamingToolCalls(wrapper.streamingMessage as unknown as AgentMessage));
  return messages;
}
async function refreshLocal(entry: Entry) {
  const wrapper = getRpcSession(entry.snapshot.ref.id);
  if (!wrapper?.isAlive()) { entry.snapshot.error = "Pi runtime is not loaded."; entry.snapshot.phase = "error"; return; }
  entry.snapshot.messages = piMessages(wrapper);
  const first = entry.snapshot.messages.find(message => message.role === "user");
  if (entry.snapshot.title === entry.snapshot.ref.id || entry.snapshot.title === "새 스레드") entry.snapshot.title = first?.role === "user" && typeof first.content === "string" ? first.content.slice(0, 120) : "새 스레드";
  entry.snapshot.phase = entry.snapshot.requests.length ? "approval" : wrapper.isRunning() ? "running" : "idle";
  const state = await wrapper.send({ type: "get_state" }) as { model?: { provider: string; id: string } };
  entry.snapshot.model = state.model ? { provider: state.model.provider, modelId: state.model.id } : null;
}
function codexSnapshot(entry: Entry, data: { thread: Record<string, unknown> }) {
  const thread = data.thread as Record<string, unknown> & { turns?: { status?: string; items?: Record<string, unknown>[] }[]; status?: { type: string } };
  entry.snapshot.title = String(thread.name || thread.preview || entry.snapshot.title || "Codex thread").slice(0, 200);
  entry.snapshot.cwd = String(thread.cwd || entry.snapshot.cwd);
  const model = String(thread.model || ""); entry.snapshot.model = { provider: "openai-codex", modelId: model };
  entry.snapshot.messages = codexMessages(thread, model);
  entry.snapshot.phase = entry.snapshot.requests.length ? "approval" : thread.status?.type === "active" || thread.turns?.some(turn => turn.status === "inProgress") ? "running" : "idle";
  const latest = thread.turns?.at(-1) as { status?: string; error?: { message?: string } } | undefined;
  if (latest?.status === "failed") { entry.snapshot.phase = "error"; entry.snapshot.error = latest.error?.message || "Codex turn failed."; }
}
async function refreshGateway(entry: Entry) {
  const ref = entry.snapshot.ref;
  const data = await entry.client!.request<Record<string, unknown>>(ref.backend, "state", { sessionId: ref.id });
  entry.snapshot.requests = ((data.requests || []) as { id?: string | number; method?: string; params?: Record<string, unknown> }[]).map(record => ref.backend === "codex" ? approvalRecord(record) : piRequest(record as Record<string, unknown>)).filter((request): request is NonNullable<typeof request> => Boolean(request));
  if (ref.backend === "codex") codexSnapshot(entry, data as unknown as { thread: Record<string, unknown> });
  else {
    const state = data.state as { isStreaming?: boolean; isCompacting?: boolean; cwd?: string; model?: { provider: string; id: string } };
    entry.snapshot.messages = ((data.messages || []) as AgentMessage[]).filter(message => message.role !== ("system" as string)).slice(-400).map(normalizeToolCalls);
    entry.snapshot.phase = entry.snapshot.requests.length ? "approval" : state.isStreaming || state.isCompacting ? "running" : "idle";
    entry.snapshot.model = state.model ? { provider: state.model.provider, modelId: state.model.id } : null;
  }
}
function ensurePolling() {
  if (store().timer) return;
  store().timer = setInterval(() => {
    const sources = new Map<string, { client: GatewayClient; backend: "pi" | "codex"; connectionId: string }>();
    for (const entry of store().entries.values()) if (entry.source === "gateway") sources.set(`${entry.snapshot.ref.connectionId}:${entry.snapshot.ref.backend}`, { client: entry.client!, backend: entry.snapshot.ref.backend, connectionId: entry.snapshot.ref.connectionId });
    for (const [key, source] of sources) {
      if (store().polling.has(key)) continue; store().polling.add(key);
      void source.client.request<{ events: { seq: number; backend: string; sessionId?: string; record: { id?: string | number; method?: string; params?: Record<string, unknown>; type?: string } }[]; cursor: number; reset?: boolean }>(source.backend, "events", { after: store().cursors.get(key) || 0 }).then(async batch => {
        store().cursors.set(key, batch.cursor);
        for (const event of batch.events) {
          if (!event.sessionId && event.record.method === "gateway/disconnected") for (const entry of store().entries.values()) if (entry.snapshot.ref.connectionId === source.connectionId && entry.snapshot.ref.backend === source.backend) { entry.snapshot.phase = "error"; entry.snapshot.error = "Runtime connection disconnected; reopen the session to reconnect."; emit(entry); }
          const entry = event.sessionId ? store().entries.get(sessionRefKey({ connectionId: source.connectionId, backend: source.backend, id: event.sessionId })) : undefined;
          if (!entry) continue;
          const record = event.record, method = record.method || record.type, params = record.params || {};
          const request = source.backend === "codex" ? approvalRecord(record) : piRequest(record as Record<string, unknown>);
          if (request) { entry.snapshot.requests = [...entry.snapshot.requests.filter(item => item.id !== request.id), request]; entry.snapshot.phase = "approval"; }
          if (method === "serverRequest/resolved") entry.snapshot.requests = entry.snapshot.requests.filter(item => item.id !== params.requestId);
          if (method === "turn/started" || method === "agent_start") entry.snapshot.phase = "running";
          if (method === "item/agentMessage/delta") { const item = String(params.itemId || ""); if (entry.streamItem !== item) { entry.streamItem = item; entry.streaming = false; } entry.snapshot.messages = codexDelta(entry.snapshot.messages, String(params.delta || ""), entry.snapshot.model?.modelId || "", Boolean(entry.streaming)); entry.streaming = true; }
          if (method === "turn/completed" || method === "agent_settled") { entry.snapshot.requests = []; entry.streaming = false; await refreshGateway(entry); }
          if (method === "item/completed" && source.backend === "codex") { entry.streaming = false; await refreshGateway(entry); }
          if (method === "item/started" && source.backend === "codex" && (params.item as { type?: string })?.type !== "agentMessage") await refreshGateway(entry);
          if (method === "message_update" && source.backend === "pi") {
            const message = (record as unknown as { message?: AgentMessage }).message;
            if (message) { const messages = entry.snapshot.messages; entry.snapshot.messages = [...messages.filter((item, index) => !(index === messages.length - 1 && item.role === "assistant")), normalizeStreamingToolCalls(message)]; }
          }
          if (method === "error" || method === "gateway/disconnected") { entry.snapshot.phase = "error"; entry.snapshot.error = "Runtime reported an error or disconnected. Refresh to reconnect."; }
          emit(entry);
        }
        if (batch.reset) for (const entry of store().entries.values()) if (entry.snapshot.ref.connectionId === source.connectionId && entry.snapshot.ref.backend === source.backend) { await refreshGateway(entry); emit(entry); }
      }).catch(() => { for (const entry of store().entries.values()) if (entry.snapshot.ref.connectionId === source.connectionId && entry.snapshot.ref.backend === source.backend) { entry.snapshot.phase = "error"; entry.snapshot.error = "Execution transport disconnected; the remote task may still be running."; emit(entry); } }).finally(() => store().polling.delete(key));
    }
  }, 500); store().timer!.unref();
}
export async function runtimeList(target: RuntimeTarget): Promise<RuntimeSessionSummary[]> {
  validTarget(target);
  if (await localPi(target)) {
    const saved = (await listAllSessions()).filter(session => session.relation?.kind !== "subagent").map(session => ({ id: session.id, title: session.name || session.firstMessage.slice(0, 100) || session.id, cwd: session.cwd, updatedAt: session.modified }));
    for (const entry of store().entries.values()) if (entry.source === "local" && !saved.some(item => item.id === entry.snapshot.ref.id)) saved.unshift({ id: entry.snapshot.ref.id, title: entry.snapshot.title, cwd: entry.snapshot.cwd, updatedAt: new Date().toISOString() });
    return saved;
  }
  const data = await (await gateway(target)).request<{ data: Record<string, unknown>[] }>(target.backend, "list", { limit: 100 });
  const sessions = data.data.map(session => ({ id: String(session.id), title: String(session.name || session.title || session.preview || session.id).slice(0, 200), cwd: String(session.cwd || ""), updatedAt: new Date(Number(session.recencyAt || session.updatedAt || 0) * 1000).toISOString(), phase: String((session.status as { type?: string })?.type || "idle") }));
  for (const entry of store().entries.values()) if (entry.snapshot.ref.connectionId === target.connectionId && entry.snapshot.ref.backend === target.backend) {
    const saved = sessions.find(item => item.id === entry.snapshot.ref.id);
    if (saved) saved.phase = entry.snapshot.phase;
    else sessions.unshift({ id: entry.snapshot.ref.id, title: entry.snapshot.title, cwd: entry.snapshot.cwd, updatedAt: new Date().toISOString(), phase: entry.snapshot.phase });
  }
  return sessions;
}
export async function runtimeOpen(ref: SessionRef): Promise<RuntimeSnapshot> {
  validRef(ref);
  return serializeByKey(LOCK, sessionRefKey(ref), async () => {
    let entry = store().entries.get(sessionRefKey(ref));
    const previous = entry;
    if (entry?.source === "local" && !getRpcSession(ref.id)?.isAlive()) { entry.unsubscribe?.(); store().entries.delete(sessionRefKey(ref)); entry = undefined; }
    if (!entry) {
      entry = { snapshot: { ref, title: ref.id, cwd: "", phase: "idle", messages: [], requests: [], cursor: previous?.snapshot.cursor || 0, epoch: store().epoch }, listeners: previous?.listeners || new Set(), source: "gateway" };
      if (await localPi(ref)) {
        entry.source = "local";
        let wrapper = getRpcSession(ref.id);
        if (!wrapper?.isAlive()) {
          const path = await resolveSessionPath(ref.id); if (!path) throw new Error("Pi session was not found.");
          wrapper = (await startRpcSession(ref.id, path, undefined)).session;
        }
        entry.snapshot.cwd = wrapper.cwd;
        const captured = entry;
        entry.unsubscribe = wrapper.onEvent(event => { const request = piRequest(event as Record<string, unknown>); if (request) captured.snapshot.requests = [...captured.snapshot.requests.filter(value => value.id !== request.id), request]; if (event.type === "agent_settled") captured.snapshot.requests = []; void refreshLocal(captured).then(() => emit(captured)).catch(() => { captured.snapshot.phase = "error"; emit(captured); }); });
        await refreshLocal(entry);
      } else {
        entry.client = await gateway(ref);
        const data = await entry.client.request<Record<string, unknown>>(ref.backend, "open", { sessionId: ref.id });
        entry.snapshot.requests = ((data.requests || []) as { id?: string | number; method?: string; params?: Record<string, unknown> }[]).map(approvalRecord).filter((request): request is NonNullable<typeof request> => Boolean(request));
        if (ref.backend === "codex") codexSnapshot(entry, data as unknown as { thread: Record<string, unknown> }); else await refreshGateway(entry);
      }
      store().entries.set(sessionRefKey(ref), entry); ensurePolling();
    } else if (entry.snapshot.phase !== "running" && entry.snapshot.phase !== "approval") {
      entry.snapshot.error = undefined;
      if (entry.source === "local") await refreshLocal(entry); else { entry.client = await gateway(ref); await entry.client.request(ref.backend, "open", { sessionId: ref.id }); await refreshGateway(entry); }
    }
    emit(entry); return plain(entry.snapshot);
  });
}
export async function runtimeCreate(target: RuntimeTarget, options: { cwd: string; requestId: string; model?: string }): Promise<RuntimeSnapshot> {
  validTarget(target);
  if (!options || typeof options.requestId !== "string" || !options.requestId || options.requestId.length > 100 || typeof options.cwd !== "string" || !options.cwd || options.cwd.length > 2000) throw new Error("Invalid creation request.");
  const key = `${target.connectionId}:${target.backend}:${options.requestId}`, fingerprint = JSON.stringify(options);
  return serializeByKey(LOCK, key, async () => {
    const previous = store().creates.get(key);
    if (previous) { if (previous.fingerprint !== fingerprint) throw new Error("Creation request id was reused with different options."); return previous.result; }
    let id: string;
    if (await localPi(target)) {
      const cwd = resolve(options.cwd === "~" ? homedir() : options.cwd.startsWith("~/") ? `${homedir()}/${options.cwd.slice(2)}` : options.cwd);
      if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error("Working directory does not exist.");
      const split = options.model?.indexOf("/") ?? -1;
      const result = await startRpcSession(`__controller_new__${randomUUID()}`, "", cwd, options.model ? { initialModel: { provider: split > 0 ? options.model.slice(0, split) : "openai-codex", modelId: split > 0 ? options.model.slice(split + 1) : options.model } } : {});
      id = result.realSessionId; invalidateSessionListCache();
    } else {
      const result = await (await gateway(target)).request<{ id: string }>(target.backend, "create", options); id = result.id;
    }
    const result = await runtimeOpen({ ...target, id });
    if (!result.messages.length) { const entry = store().entries.get(sessionRefKey(result.ref))!; entry.snapshot.title = "새 스레드"; emit(entry); result.title = entry.snapshot.title; result.cursor = entry.snapshot.cursor; }
    store().creates.set(key, { fingerprint, result }); return result;
  });
}
export async function runtimeSend(ref: SessionRef, message: string) {
  validRef(ref);
  if (typeof message !== "string" || !message.trim() || message.length > 100000) throw new Error("Invalid message.");
  return serializeByKey(LOCK, `send:${sessionRefKey(ref)}`, async () => {
  await runtimeOpen(ref); const entry = store().entries.get(sessionRefKey(ref))!;
  if (entry.snapshot.phase === "running" || entry.snapshot.phase === "approval") throw new Error("Session is already running or awaiting an answer.");
  entry.snapshot.phase = "running"; entry.snapshot.error = undefined; emit(entry);
  try {
    if (entry.source === "local") await getRpcSession(ref.id)!.send({ type: "prompt", message });
    else await entry.client!.request(ref.backend, "send", { sessionId: ref.id, message });
    if (entry.source === "local") await refreshLocal(entry); else await refreshGateway(entry); emit(entry);
    return plain(entry.snapshot);
  } catch (error) { entry.snapshot.error = error instanceof Error ? error.message : "Send failed."; entry.snapshot.phase = "error"; emit(entry); throw error; }
  });
}
export async function runtimeInterrupt(ref: SessionRef) {
  validRef(ref); const entry = store().entries.get(sessionRefKey(ref)); if (!entry) throw new Error("Open the session first.");
  if (entry.source === "local") await getRpcSession(ref.id)!.send({ type: "abort" }); else await entry.client!.request(ref.backend, "interrupt", { sessionId: ref.id });
  return runtimeOpen(ref);
}
export async function runtimeReply(ref: SessionRef, requestId: string | number, answer: RuntimeAnswer) {
  validRef(ref); if (!answer || typeof answer !== "object") throw new Error("Invalid request answer.");
  const entry = store().entries.get(sessionRefKey(ref)); if (!entry?.snapshot.requests.some(request => request.id === requestId)) throw new Error("Request is no longer pending in this session.");
  if (entry.source === "local") { const request = entry.snapshot.requests.find(item => item.id === requestId)!; await getRpcSession(ref.id)!.send({ type: "extension_ui_response", id: requestId, ...(request.method === "pi:confirm" ? { confirmed: answer.decision === "accept" } : answer.cancelled ? { cancelled: true } : { value: answer.value || answer.answers?.value || "" }) }); }
  else await entry.client!.request(ref.backend, "reply", { sessionId: ref.id, requestId, answer });
  entry.snapshot.requests = entry.snapshot.requests.filter(request => request.id !== requestId); emit(entry); return plain(entry.snapshot);
}
export async function runtimeModels(target: RuntimeTarget) {
  if (await localPi(target)) {
    const agentDir = getAgentDir(), reload = projectTrustReloadOptions(process.cwd(), agentDir);
    const services = await createAgentSessionServices({ cwd: process.cwd(), agentDir, ...(reload ? { resourceLoaderReloadOptions: reload } : {}) });
    const scope = await resolveVisibleModels(services.modelRuntime, services.settingsManager.getEnabledModels());
    return scope.visible.map(model => ({ id: `${model.provider}/${model.id}`, name: `${model.name} · ${model.provider}` }));
  }
  const data = await (await gateway(target)).request<{ data?: { id: string; displayName?: string; model?: string }[]; models?: { id: string; name: string }[] }>(target.backend, "models");
  return (data.data || data.models || []).map(model => ({ id: model.id, name: "displayName" in model ? model.displayName || model.id : "name" in model ? model.name : model.id }));
}
export async function runtimeWatch(ref: SessionRef, listener: (snapshot: RuntimeSnapshot) => void) {
  await runtimeOpen(ref); const entry = store().entries.get(sessionRefKey(ref))!; entry.listeners.add(listener); listener(plain(entry.snapshot)); return () => entry.listeners.delete(listener);
}
export function executionProvider(target: RuntimeTarget) {
  return createExecutionProvider(target, { list: runtimeList, models: runtimeModels, create: runtimeCreate, open: runtimeOpen, send: runtimeSend, interrupt: runtimeInterrupt, reply: runtimeReply, watch: runtimeWatch });
}
export async function runtimeInfo(target: RuntimeTarget) {
  validTarget(target);
  const info = await (await gateway(target)).request<{ pi: boolean; codex: boolean }>(target.backend, "info");
  return { agents: { pi: target.connectionId === "local" || info.pi, codex: info.codex } };
}
