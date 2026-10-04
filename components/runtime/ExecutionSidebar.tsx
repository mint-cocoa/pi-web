"use client";
import { useState } from "react";
import { sessionRefKey, type SessionRef } from "@/lib/session-provider";
import type { ExecutionGroup } from "@/hooks/useExecutionGroups";

export function ExecutionSidebar({ groups, selected, onSelect, onNew }: {
  groups: ExecutionGroup[]; selected: SessionRef | null; onSelect: (ref: SessionRef) => void; onNew: (group: ExecutionGroup) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<Record<string, number>>({});
  const active = groups.find(group => group.id === selected?.connectionId) || groups[0];
  const button = { padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 };
  return <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
    <div style={{ padding: "12px 10px 10px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
        <strong style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 18 }}>Pi Web</strong>
        <button type="button" onClick={() => active && onNew(active)} disabled={!active?.backends.length} style={button}>＋ New</button>
        <button type="button" onClick={() => setSearchOpen(value => !value)} aria-label="세션 검색" aria-expanded={searchOpen} style={button}>⌕</button>
      </div>
      {searchOpen && <input type="search" aria-label="세션 검색어" autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search conversations…" style={{ ...button, marginTop: 7, width: "100%", cursor: "text" }} />}
    </div>
    <div style={{ overflowY: "auto", flex: 1, padding: "12px 8px" }}>
      <div style={{ padding: "0 10px 12px", fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>연결</div>
      {groups.map((group, groupIndex) => {
        const sessions = group.sessions.filter(session => `${session.title} ${session.cwd}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
        const limit = query ? sessions.length : limits[group.id] || 5;
        const visible = sessions.slice(0, limit);
        const current = sessions.find(session => selected && sessionRefKey(session) === sessionRefKey(selected));
        if (current && !visible.includes(current)) visible.push(current);
        const closed = collapsed[group.id] && !query;
        return <section key={group.id} aria-label={`${group.label} 세션`} style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", gap: 4, alignItems: "center", borderRadius: 9, background: selected?.connectionId === group.id ? "var(--bg-hover)" : "transparent" }}>
            <button type="button" aria-expanded={!closed} onClick={() => setCollapsed(value => ({ ...value, [group.id]: !value[group.id] }))} style={{ flex: 1, padding: "9px 10px", background: "transparent", border: 0, color: "var(--text-muted)", cursor: "pointer", textAlign: "left", display: "flex", gap: 9, alignItems: "center", fontSize: 13 }}>
              <span aria-hidden="true" style={{ color: ["#63a8a0", "#8c8cdf", "#cfa756"][groupIndex % 3] }}>{group.id === "local" ? "▱" : "◎"}</span>
              <span style={{ flex: 1 }}>{group.label}</span>
              <span title={group.state === "connected" ? "연결됨" : group.state === "loading" ? "연결 확인 중" : "연결 오류"} aria-label={group.state === "connected" ? "연결됨" : group.state === "loading" ? "연결 확인 중" : "연결 오류"} style={{ width: 7, height: 7, borderRadius: "50%", background: group.state === "connected" ? "#35a36a" : group.state === "loading" ? "#bd9d55" : "#d36767" }} />
            </button>
            <button type="button" aria-label={`${group.label} 새 스레드`} title={`${group.label} 새 스레드`} disabled={!group.backends.length} onClick={() => onNew(group)} style={{ background: "transparent", border: 0, color: "var(--text-muted)", fontSize: 18, padding: "6px 10px", cursor: "pointer" }}>＋</button>
          </div>
          {!closed && <>
            {group.error && <p role="alert" style={{ padding: "4px 12px", fontSize: 11, color: "#d36767" }}>{group.error}</p>}
            {!sessions.length && !group.error && <p style={{ margin: "6px 0 12px 32px", color: "var(--text-dim)", fontSize: 12 }}>{group.state === "loading" ? "연결 확인 중…" : "세션 없음"}</p>}
            {visible.map(session => {
              const selectedRow = selected && sessionRefKey(session) === sessionRefKey(selected);
              return <button key={sessionRefKey(session)} type="button" aria-current={selectedRow ? "page" : undefined} onClick={() => onSelect(session)} title={`${session.title}\n${session.cwd}\n${session.backend}`}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, padding: "10px 10px 10px 32px", border: 0, borderRadius: 9, background: selectedRow ? "var(--bg-selected)" : "transparent", color: "var(--text)", textAlign: "left", cursor: "pointer", fontSize: 13 }}>
                <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{session.title}</span>
                <small style={{ color: "var(--text-dim)", fontSize: 9 }}>{session.backend === "pi" ? "Pi" : "Codex"}</small>
                {(session.phase === "running" || session.phase === "active" || session.phase === "approval") && <span aria-label="실행 중">◌</span>}
              </button>;
            })}
            {sessions.length > limit && <button type="button" onClick={() => setLimits(value => ({ ...value, [group.id]: limit + 5 }))} style={{ padding: "9px 10px 9px 32px", border: 0, background: "transparent", color: "var(--text-dim)", cursor: "pointer", fontSize: 12 }}>더 보기</button>}
          </>}
        </section>;
      })}
    </div>
  </div>;
}
