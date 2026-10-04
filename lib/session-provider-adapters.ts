import { createSessionProvider, type SessionConnection, type SessionRef, type SessionSummary, type SessionTranscript } from "./session-provider";
import { connectionRequest, type ConnectionSnapshot } from "./connections/client";
import { AgentCommandError } from "./agent-client";

export type SessionJsonRequest = <T>(url: string, body?: Record<string, unknown>, signal?: AbortSignal, method?: string) => Promise<T>;
export const sessionJsonRequest: SessionJsonRequest = async <T>(url: string, body?: Record<string, unknown>, signal?: AbortSignal, method?: string) => {
  const response = await fetch(url, { method: method || (body ? "POST" : "GET"), headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal, cache: "no-store" });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new AgentCommandError(data.error || `HTTP ${response.status}`, response.status, data.code, data.accepted);
  }
  return data as T;
};
function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(item => item && typeof item === "object" && item.type === "text" && typeof item.text === "string").map(item => item.text).join("\n");
}
export function createLocalPiProvider(catalog: () => readonly SessionSummary[], request = sessionJsonRequest) {
  const url = (ref: SessionRef) => `/api/sessions/${encodeURIComponent(ref.id)}`;
  return createSessionProvider({ connection: { id: "local", alias: "local", label: "로컬" }, backend: "pi", catalog,
    operations: {
      async read(ref, signal) {
        const data = await request<{ context: { messages: { role: string; content: unknown }[]; hasMore?: boolean } }>(url(ref) + "?tail=100", undefined, signal);
        return { messages: data.context.messages.map(message => ({ role: message.role, text: text(message.content) })).filter(message => message.text), truncated: data.context.hasMore === true };
      },
      async send(ref, message, signal) { const result = await request<{ data: unknown }>(`/api/agent/${encodeURIComponent(ref.id)}`, { type: "prompt", message }, signal); return result.data; },
      rename: (ref, name, signal) => request(url(ref), { name }, signal, "PATCH"),
      remove: (ref, signal) => request(url(ref), undefined, signal, "DELETE"),
      subscribe(ref, listener) {
        const events = new EventSource(`/api/agent/${encodeURIComponent(ref.id)}/events`);
        events.onmessage = event => { let data: unknown; try { data = JSON.parse(event.data); } catch { return; } listener(data); };
        return () => events.close();
      },
    },
  });
}
export function createSshSessionProvider(connection: SessionConnection, backend: SessionRef["backend"], catalog: () => readonly SessionSummary[], request = connectionRequest) {
  connection = Object.freeze({ ...connection });
  return createSessionProvider({ connection, backend, catalog, operations: {
    async read(ref, signal) {
      const snapshot = await request<ConnectionSnapshot>(undefined, signal);
      const current = snapshot.connections.find(item => item.id === connection.id);
      if (!current || current.alias !== connection.alias) throw new Error("연결 등록이 변경되었습니다. 세션을 다시 선택하세요.");
      if (current.state !== "connected") throw new Error("먼저 서버에 연결하세요.");
      if (!current.inventory?.sessions.some(item => item.id === ref.id && item.backend === backend)) throw new Error("서버의 현재 목록에 세션이 없습니다.");
      return request<SessionTranscript>({ action: "transcript", id: connection.id, sessionId: ref.id }, signal);
    },
  } });
}
