import type { SessionRef } from "../session-provider";
import type { RuntimeAnswer, RuntimeSnapshot, RuntimeTarget, RuntimeSessionSummary } from "./types";

export interface ExecutionOperations {
  list(target: RuntimeTarget): Promise<RuntimeSessionSummary[]>;
  models(target: RuntimeTarget): Promise<{ id: string; name: string }[]>;
  create(target: RuntimeTarget, options: { cwd: string; requestId: string; model?: string }): Promise<RuntimeSnapshot>;
  open(ref: SessionRef): Promise<RuntimeSnapshot>;
  send(ref: SessionRef, message: string): Promise<RuntimeSnapshot>;
  interrupt(ref: SessionRef): Promise<RuntimeSnapshot>;
  reply(ref: SessionRef, requestId: string | number, answer: RuntimeAnswer): Promise<RuntimeSnapshot>;
  watch(ref: SessionRef, listener: (snapshot: RuntimeSnapshot) => void): Promise<() => void>;
}

/** UI-independent provider: every operation stays bound to one computer and engine. */
export function createExecutionProvider(target: RuntimeTarget, operations: ExecutionOperations) {
  if (!target || typeof target.connectionId !== "string" || !target.connectionId || !["pi", "codex"].includes(target.backend)) throw new Error("Invalid execution provider.");
  const bound = Object.freeze({ connectionId: target.connectionId, backend: target.backend });
  const ref = (value: SessionRef) => {
    if (!value || value.connectionId !== bound.connectionId || value.backend !== bound.backend || typeof value.id !== "string") throw new Error("Session reference does not belong to this provider.");
    return Object.freeze({ ...bound, id: value.id });
  };
  return Object.freeze({
    target: bound,
    list: () => operations.list(bound),
    models: () => operations.models(bound),
    create: (options: { cwd: string; requestId: string; model?: string }) => operations.create(bound, { ...options }),
    open: (value: SessionRef) => operations.open(ref(value)),
    send: (value: SessionRef, message: string) => operations.send(ref(value), message),
    interrupt: (value: SessionRef) => operations.interrupt(ref(value)),
    reply: (value: SessionRef, id: string | number, answer: RuntimeAnswer) => operations.reply(ref(value), id, answer),
    watch: (value: SessionRef, listener: (snapshot: RuntimeSnapshot) => void) => operations.watch(ref(value), listener),
  });
}
