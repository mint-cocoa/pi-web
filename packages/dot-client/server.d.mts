import type { CredentialProvider, Dot, DotMessage, DotSnapshot, Environment } from "./core.mjs";
export class DotClient {
  constructor(credentials: CredentialProvider, options?: { fetch?: typeof fetch });
  list(signal?: AbortSignal): Promise<Dot[]>;
  resolve(threadId: string, signal?: AbortSignal): Promise<Dot>;
  messages(dot: Dot, options?: { limit?: number; before?: string; signal?: AbortSignal }): Promise<{ messages: DotMessage[]; before: string | null }>;
  environment(dot: Dot, signal?: AbortSignal): Promise<Environment>;
  snapshot(threadId: string, signal?: AbortSignal): Promise<DotSnapshot>;
  send(threadId: string, text: string, requestId: string, signal?: AbortSignal): Promise<{ accepted: boolean; requestId: string }>;
  computerOffer(threadId: string, offer: string, signal?: AbortSignal): Promise<string>;
  live(threadId: string, signal?: AbortSignal): AsyncGenerator<{ type: "changed" }>;
}
export type DotEvent = { type: "snapshot"; snapshot: DotSnapshot } | { type: "error"; code: string };
export class DotRuntime {
  constructor(client: DotClient, options?: { intervalMs?: number });
  subscribe(threadId: string, listener: (event: DotEvent) => void): () => void;
  close(): void;
}
