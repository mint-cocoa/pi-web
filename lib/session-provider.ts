/** Transport-neutral session domain. No React, SDK, SSH or filesystem imports. */
export interface SessionRef { readonly connectionId: string; readonly backend: "pi" | "codex"; readonly id: string }
export interface SessionSummary extends SessionRef {
  title: string; cwd: string; updatedAt: string;
  pinned?: boolean; archived?: boolean; transient?: boolean;
}
export interface SessionTranscript { messages: { role: string; text: string }[]; truncated: boolean }
export interface SessionConnection { id: string; alias: string; label: string }
export interface SessionCapabilities {
  read: boolean; send: boolean; rename: boolean; remove: boolean; live: boolean;
}
export interface SessionProvider {
  connection: Readonly<SessionConnection>;
  backend: SessionRef["backend"];
  capabilities: Readonly<SessionCapabilities>;
  catalog(): readonly SessionSummary[];
  list(signal?: AbortSignal): Promise<readonly SessionSummary[]>;
  read(ref: SessionRef, signal?: AbortSignal): Promise<SessionTranscript>;
  send(ref: SessionRef, message: string, signal?: AbortSignal): Promise<unknown>;
  rename(ref: SessionRef, name: string, signal?: AbortSignal): Promise<unknown>;
  remove(ref: SessionRef, signal?: AbortSignal): Promise<unknown>;
  subscribe(ref: SessionRef, listener: (event: unknown) => void): () => void;
}
export interface SessionSelection { ref: SessionRef; summary: SessionSummary; provider: SessionProvider }
export class UnsupportedSessionOperation extends Error {
  constructor(operation: string) { super(`이 세션 제공자는 ${operation} 기능을 지원하지 않습니다.`); this.name = "UnsupportedSessionOperation"; }
}
export function sessionRefKey(ref: SessionRef): string { return JSON.stringify([ref.connectionId, ref.backend, ref.id]); }
function providerKey(ref: Pick<SessionRef, "connectionId" | "backend">) { return JSON.stringify([ref.connectionId, ref.backend]); }

export function createSessionProvider(spec: {
  connection: SessionConnection; backend: SessionRef["backend"];
  catalog: () => readonly SessionSummary[];
  operations: {
    list?: (signal?: AbortSignal) => Promise<readonly SessionSummary[]>;
    read: (ref: SessionRef, signal?: AbortSignal) => Promise<SessionTranscript>;
    send?: (ref: SessionRef, message: string, signal?: AbortSignal) => Promise<unknown>;
    rename?: (ref: SessionRef, name: string, signal?: AbortSignal) => Promise<unknown>;
    remove?: (ref: SessionRef, signal?: AbortSignal) => Promise<unknown>;
    subscribe?: (ref: SessionRef, listener: (event: unknown) => void) => () => void;
  };
}): SessionProvider {
  const connection = Object.freeze({ ...spec.connection });
  const ops = Object.freeze({ ...spec.operations }), catalog = spec.catalog, backend = spec.backend;
  if (typeof ops.read !== "function" || typeof spec.catalog !== "function") throw new Error("세션 제공자에 조회 기능이 필요합니다.");
  for (const name of ["send", "rename", "remove", "subscribe", "list"] as const) if (ops[name] !== undefined && typeof ops[name] !== "function") throw new Error("잘못된 세션 제공자 기능입니다.");
  const capabilities = Object.freeze({ read: true, send: Boolean(ops.send), rename: Boolean(ops.rename), remove: Boolean(ops.remove), live: Boolean(ops.subscribe) });
  function validate(ref: SessionRef, diskAction = false) {
    const target = Object.freeze({ connectionId: ref.connectionId, backend: ref.backend, id: ref.id });
    if (target.connectionId !== connection.id || target.backend !== backend) throw new Error("세션 제공자와 참조가 일치하지 않습니다.");
    const session = catalog().find(item => sessionRefKey(item) === sessionRefKey(target));
    if (!session) throw new Error("세션이 제공자의 현재 목록에 없습니다.");
    if (diskAction && session.transient) throw new Error("아직 저장되지 않은 세션입니다.");
    return target;
  }
  const summary = (items: readonly SessionSummary[]) => {
    if (items.some(item => item.connectionId !== connection.id || item.backend !== backend)) throw new Error("다른 제공자의 세션이 반환되었습니다.");
    return items;
  };
  const provider: SessionProvider = {
    connection, backend, capabilities,
    catalog: () => summary(catalog()),
    async list(signal) { if (signal?.aborted) throw new DOMException("Aborted", "AbortError"); return summary(ops.list ? await ops.list(signal) : catalog()); },
    async read(ref, signal) { return ops.read(validate(ref), signal); },
    async send(ref, message, signal) { if (!ops.send) throw new UnsupportedSessionOperation("메시지 전송"); const target = validate(ref); if (!message.trim()) throw new Error("메시지가 비어 있습니다."); return ops.send(target, message, signal); },
    async rename(ref, name, signal) { if (!ops.rename) throw new UnsupportedSessionOperation("이름 변경"); const target = validate(ref, true); if (!name.trim()) throw new Error("이름이 비어 있습니다."); return ops.rename(target, name, signal); },
    async remove(ref, signal) { if (!ops.remove) throw new UnsupportedSessionOperation("삭제"); return ops.remove(validate(ref, true), signal); },
    subscribe(ref, listener) { if (!ops.subscribe) throw new UnsupportedSessionOperation("실시간 이벤트"); return ops.subscribe(validate(ref), listener); },
  };
  return Object.freeze(provider);
}
export class SessionProviderRegistry {
  private readonly providers = new Map<string, SessionProvider>();
  constructor(providers: readonly SessionProvider[]) {
    for (const provider of providers) {
      const key = providerKey({ connectionId: provider.connection.id, backend: provider.backend });
      if (this.providers.has(key)) throw new Error("중복된 세션 제공자입니다.");
      this.providers.set(key, provider);
    }
  }
  get(ref: SessionRef): SessionProvider {
    const provider = this.providers.get(providerKey(ref));
    if (!provider) throw new Error("세션 제공자가 등록되지 않았습니다.");
    return provider;
  }
  select(ref: SessionRef): SessionSelection {
    const provider = this.get(ref), summary = provider.catalog().find(item => sessionRefKey(item) === sessionRefKey(ref));
    if (!summary) throw new Error("선택할 세션이 목록에 없습니다.");
    return { ref: Object.freeze({ connectionId: ref.connectionId, backend: ref.backend, id: ref.id }), summary, provider };
  }
  read(ref: SessionRef, signal?: AbortSignal) { return this.get(ref).read(ref, signal); }
  async list(signal?: AbortSignal) {
    return Promise.all([...this.providers.values()].map(async provider => {
      try { return { provider, sessions: await provider.list(signal) }; }
      catch (error) { return { provider, sessions: [] as SessionSummary[], error }; }
    }));
  }
}
