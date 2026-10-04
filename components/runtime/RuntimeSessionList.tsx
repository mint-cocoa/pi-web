"use client";
import type { SessionRef } from "@/lib/session-provider";
import type { RuntimeSessionSummary, RuntimeTarget } from "@/lib/runtime/types";
export function RuntimeSessionList({ target, sessions, selected, error, onSelect }: { target: RuntimeTarget; sessions: RuntimeSessionSummary[]; selected: SessionRef | null; error: string; onSelect: (ref: SessionRef) => void }) {
  return <div style={{ overflowY: "auto", flex: 1 }}>
    {error && <p role="alert" style={{ padding: "10px 14px", fontSize: 12, color: "#e76c6c" }}>{error}</p>}
    {!error && !sessions.length && <p style={{ padding: "14px", color: "var(--text-muted)", fontSize: 12 }}>No sessions found</p>}
    {sessions.map(session => <button type="button" key={session.id} aria-current={selected?.id === session.id ? "page" : undefined} onClick={() => onSelect({ ...target, id: session.id })} title={`${session.title}\n${session.cwd}`}
      style={{ width: "100%", height: 54, padding: "8px 14px", border: "none", borderLeft: selected?.id === session.id ? "2px solid var(--accent)" : "2px solid transparent", background: selected?.id === session.id ? "var(--bg-selected)" : "transparent", color: "var(--text)", textAlign: "left", cursor: "pointer" }}>
      <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 12 }}>{session.title}</span>
      <small style={{ display: "block", color: "var(--text-dim)", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{session.cwd}</small>
    </button>)}
  </div>;
}
