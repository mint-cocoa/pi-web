import type { SessionRef, SessionSelection } from "./session-provider";

/** Display policy is separate from session transport and SDK implementations. */
export interface SessionViewModel {
  title: string; subtitle: string; cwd: string;
  canRead: boolean; canSend: boolean; canRename: boolean; canRemove: boolean; isLive: boolean;
}
export function sessionViewModel(selection: SessionSelection): Readonly<SessionViewModel> {
  const caps = selection.provider.capabilities;
  return Object.freeze({ title: selection.summary.title, subtitle: `${selection.provider.connection.label} · ${selection.ref.backend}`,
    cwd: selection.summary.cwd, canRead: caps.read, canSend: caps.send, canRename: caps.rename, canRemove: caps.remove, isLive: caps.live });
}
export interface SessionViewAdapter<Row, Conversation> {
  id: string;
  target?: Readonly<Partial<Pick<SessionRef, "connectionId" | "backend">>>;
  mode?: "native" | "overlay";
  row?: Row;
  conversation?: Conversation;
}
/** Exact provider registration wins over backend registration and defaults. */
export class SessionViewRegistry<Row, Conversation> {
  private readonly adapters: readonly Readonly<SessionViewAdapter<Row, Conversation>>[];
  constructor(adapters: readonly SessionViewAdapter<Row, Conversation>[]) {
    const ids = new Set<string>(), targets = new Set<string>();
    this.adapters = adapters.map(adapter => {
      const target = Object.freeze({ ...adapter.target });
      const key = JSON.stringify([target.connectionId ?? null, target.backend ?? null]);
      if (ids.has(adapter.id) || targets.has(key)) throw new Error("중복된 세션 표시 어댑터입니다.");
      ids.add(adapter.id); targets.add(key);
      return Object.freeze({ ...adapter, target });
    });
  }
  resolve(ref: SessionRef): Readonly<SessionViewAdapter<Row, Conversation>> {
    const rank = (adapter: SessionViewAdapter<Row, Conversation>) => (adapter.target?.connectionId ? 2 : 0) + (adapter.target?.backend ? 1 : 0);
    const matches = this.adapters.filter(adapter => (!adapter.target?.connectionId || adapter.target.connectionId === ref.connectionId) && (!adapter.target?.backend || adapter.target.backend === ref.backend));
    if (!matches.length) throw new Error("세션 표시 어댑터가 등록되지 않았습니다.");
    const ordered = matches.sort((a, b) => rank(a) - rank(b));
    let result: SessionViewAdapter<Row, Conversation> = { id: "" };
    for (const adapter of ordered) {
      result = { ...result, id: adapter.id, target: adapter.target,
        ...(adapter.mode !== undefined ? { mode: adapter.mode } : {}),
        ...(adapter.row !== undefined ? { row: adapter.row } : {}),
        ...(adapter.conversation !== undefined ? { conversation: adapter.conversation } : {}),
      };
    }
    return Object.freeze(result);
  }
}
