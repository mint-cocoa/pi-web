import type { SessionRef } from "../session-provider";
import type { RuntimeAnswer, RuntimeSnapshot, RuntimeTarget } from "./types";
export async function runtimeRequest<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/runtime", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || "Runtime request failed."); return data;
}
/** One controller contract drives both native SDK and remote app-server runtimes. */
export class SessionController {
  readonly ref: SessionRef;
  constructor(ref: SessionRef) { this.ref = Object.freeze({ ...ref }); }
  static create(target: RuntimeTarget, cwd: string, model?: string, requestId = crypto.randomUUID()) {
    return runtimeRequest<RuntimeSnapshot>({ action: "create", target, options: { cwd, model, requestId } });
  }
  open() { return runtimeRequest<RuntimeSnapshot>({ action: "open", ref: this.ref }); }
  send(message: string) { return runtimeRequest<RuntimeSnapshot>({ action: "send", ref: this.ref, message }); }
  interrupt() { return runtimeRequest<RuntimeSnapshot>({ action: "interrupt", ref: this.ref }); }
  reply(requestId: string | number, answer: RuntimeAnswer) { return runtimeRequest<RuntimeSnapshot>({ action: "reply", ref: this.ref, requestId, answer }); }
  subscribe(listener: (snapshot: RuntimeSnapshot) => void, onError?: () => void) {
    const params = new URLSearchParams({ connectionId: this.ref.connectionId, backend: this.ref.backend, sessionId: this.ref.id });
    const events = new EventSource(`/api/runtime/events?${params}`);
    events.onmessage = event => { const snapshot = JSON.parse(event.data) as RuntimeSnapshot; listener(snapshot); };
    events.onerror = () => onError?.(); return () => events.close();
  }
}
