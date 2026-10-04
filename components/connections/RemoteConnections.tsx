"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfigPanelShell, ConfigSplitView, ConfigSidebar, ConfigSidebarList, ConfigSidebarItem,
  ConfigButton, ConfigSaveTarget, ConfigDetailGrid, ConfigDetailGridRow } from "../SettingsUi";
import { openStackedDialog } from "@/lib/stacked-dialog";
import type { RemoteConnection, RemoteTranscript } from "@/lib/connections/types";
import { connectionRequest as api } from "@/lib/connections/client";
import "./remote-connections.css";

interface Snapshot { connections: RemoteConnection[]; aliases: string[]; configPath: string }
const STATES = { disconnected: "연결 해제", connecting: "연결 중", connected: "연결됨", error: "연결 오류" };

export function RemoteConnections({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const active = useRef(true);
  const requestSequence = useRef(0);
  const operationSequence = useRef(0);
  const [data, setData] = useState<Snapshot>({ connections: [], aliases: [], configPath: "~/.pi/agent/remote-connections.json" });
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string>();
  const [alias, setAlias] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState<RemoteTranscript>();
  const [sessionTitle, setSessionTitle] = useState("");
  const item = data.connections.find(connection => connection.id === selected);
  const reload = useCallback(async () => {
    const snapshot = await api<Snapshot>();
    if (active.current) setData(snapshot);
  }, []);
  useEffect(() => {
    active.current = true;
    const cleanup = openStackedDialog(document, panel.current, () => close.current());
    void reload().catch(value => { if (active.current) setError(value.message); });
    const interval = setInterval(() => { void reload().catch(() => {}); }, 5000);
    return () => { active.current = false; clearInterval(interval); cleanup(); };
  }, [reload]);
  async function operation(body: Record<string, unknown>) {
    const sequence = ++operationSequence.current;
    setBusy(true); setError("");
    try {
      await api(body);
      if (!active.current || sequence !== operationSequence.current) return;
      await reload();
      if (active.current && body.action === "save") setEditing(false);
      if (active.current && (body.action === "disconnect" || body.action === "remove")) setTranscript(undefined);
    } catch (value) { if (active.current && sequence === operationSequence.current) setError(value instanceof Error ? value.message : "연결 요청에 실패했습니다."); }
    finally { if (active.current && sequence === operationSequence.current) setBusy(false); }
  }
  function beginEdit(connection?: RemoteConnection) {
    requestSequence.current++; setTranscript(undefined); setError(""); setEditing(true);
    setEditId(connection?.id); setAlias(connection?.alias || data.aliases.find(value => !data.connections.some(item => item.alias === value)) || "");
    setLabel(connection?.label || "");
  }
  async function readSession(id: string, title: string) {
    const sequence = ++requestSequence.current;
    setBusy(true); setError(""); setTranscript(undefined); setSessionTitle(title);
    try {
      const value = await api<RemoteTranscript>({ action: "transcript", id: selected, sessionId: id });
      if (active.current && sequence === requestSequence.current) setTranscript(value);
    } catch (value) { if (active.current && sequence === requestSequence.current) setError(value instanceof Error ? value.message : "세션을 읽지 못했습니다."); }
    finally { if (active.current && sequence === requestSequence.current) setBusy(false); }
  }
  return <div className="remote-connections" ref={panel} tabIndex={-1} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Tab") {
      const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]') || [])];
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <ConfigPanelShell embedded={false} title="원격 연결" subtitle="SSH · Pi / Codex" closeLabel="원격 연결 닫기" onClose={onClose} width={1040} height="82vh">
      <ConfigSplitView>
        <ConfigSidebar>
          <div className="remote-add"><ConfigButton size="small" onClick={() => beginEdit()} disabled={busy}>＋ 연결 등록</ConfigButton></div>
          <ConfigSidebarList>{data.connections.map(connection => <ConfigSidebarItem key={connection.id} active={connection.id === selected && !editing} disabled={busy}
            onClick={() => { requestSequence.current++; setSelected(connection.id); setEditing(false); setTranscript(undefined); setError(""); }}>
            <span className={"remote-dot is-" + connection.state} /><span className="remote-connection-name">{connection.label}<small>{connection.alias} · {STATES[connection.state]}</small></span>
          </ConfigSidebarItem>)}</ConfigSidebarList>
        </ConfigSidebar>
        <section className="remote-detail" aria-busy={busy}>
          {error && <p role="alert" className="remote-error">{error}</p>}
          {editing ? <form onSubmit={event => { event.preventDefault(); void operation({ action: "save", id: editId, alias, label }); }}>
            <h2>{editId ? "연결 수정" : "연결 등록"}</h2>
            <ConfigSaveTarget value="global" options={[{ value: "global", label: "서버 공통" }]} label="저장 위치" path={data.configPath} onChange={() => {}} />
            <label className="remote-field">이름<input value={label} maxLength={80} required onChange={event => setLabel(event.target.value)} /></label>
            <label className="remote-field">SSH 별칭<select value={alias} required onChange={event => { setAlias(event.target.value); if (!label) setLabel(event.target.value); }}>
              <option value="">별칭 선택</option>{data.aliases.map(value => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <p className="remote-note">Pi Web 서버의 ~/.ssh/config에 등록된 별칭을 사용합니다. 새 서버는 해당 서버의 SSH 설정과 known_hosts를 먼저 준비하세요.</p>
            {!data.aliases.length && <p>등록 가능한 SSH 별칭이 없습니다.</p>}
            <div className="remote-actions"><ConfigButton type="submit" variant="primary" disabled={busy || !alias || !label.trim()}>저장</ConfigButton><ConfigButton onClick={() => setEditing(false)} disabled={busy}>취소</ConfigButton></div>
          </form> : item ? <>
            <header className="remote-header"><h2>{item.label}</h2><span className={"remote-dot is-" + item.state} />{STATES[item.state]}</header>
            <div className="remote-actions">
              {item.state === "connected" || item.state === "connecting" ? <ConfigButton onClick={() => void operation({ action: "disconnect", id: item.id })}>연결 해제</ConfigButton> : <ConfigButton variant="primary" onClick={() => void operation({ action: "connect", id: item.id })} disabled={busy}>{busy ? "연결 중…" : "SSH 연결"}</ConfigButton>}
              <ConfigButton onClick={() => void operation({ action: "refresh", id: item.id })} disabled={busy || item.state !== "connected"}>세션 새로고침</ConfigButton>
              <ConfigButton onClick={() => beginEdit(item)} disabled={busy}>수정</ConfigButton>
              <ConfigButton variant="danger" onClick={() => void operation({ action: "remove", id: item.id })} disabled={busy}>등록 삭제</ConfigButton>
            </div>
            {item.error && <p role="alert" className="remote-error">{item.error}</p>}
            <ConfigDetailGrid>
              <ConfigDetailGridRow label="SSH 별칭" mono>{item.alias}</ConfigDetailGridRow>
              <ConfigDetailGridRow label="서버 / 사용자">{item.inventory ? `${item.inventory.hostname} / ${item.inventory.user}` : "연결 후 확인"}</ConfigDetailGridRow>
              <ConfigDetailGridRow label="에이전트 설치">{item.inventory ? `Pi ${item.inventory.agents.pi ? "✓" : "없음"} · Codex ${item.inventory.agents.codex ? "✓" : "없음"}` : "연결 후 확인"}</ConfigDetailGridRow>
              <ConfigDetailGridRow label="마지막 확인">{item.checkedAt ? new Date(item.checkedAt).toLocaleString() : "아직 확인하지 않음"}</ConfigDetailGridRow>
            </ConfigDetailGrid>
            {item.state === "connected" && item.inventory && <>
              <h3>원격 세션 기록 · {item.inventory.sessions.length}{item.inventory.truncated ? "+" : ""}</h3>
              <p className="remote-note">세션 기록을 조회합니다. 실행 중 여부는 이 목록에 표시되지 않습니다.</p>
              <div className="remote-session-list">{item.inventory.sessions.map(session => <button type="button" key={session.id} disabled={busy} onClick={() => void readSession(session.id, session.title)}>
                <span className="remote-session-kind">{session.backend}</span><span>{session.pinned ? "📌 " : ""}{session.title}{session.archived ? " · 보관됨" : ""}<small>{session.cwd} · {new Date(session.updatedAt).toLocaleString()}</small></span>
              </button>)}{!item.inventory.sessions.length && <p>저장된 Pi / Codex 세션이 없습니다.</p>}</div>
            </>}
            {transcript && <section className="remote-transcript" aria-label="원격 세션 내용"><h3>{sessionTitle}</h3><p className="remote-note">읽기 전용 · 대화 메시지 최대 100개{transcript.truncated ? " · 일부 내용만 표시됨" : ""}</p>
              {transcript.messages.map((message, index) => <article key={index}><strong>{message.role}</strong><pre>{message.text}</pre></article>)}
              {!transcript.messages.length && <p>표시할 대화 메시지가 없습니다.</p>}
            </section>}
          </> : <div className="remote-empty"><h2>서버를 선택하세요</h2><p>기존 SSH 설정으로 연결한 뒤 서버별 Pi·Codex 세션을 확인할 수 있습니다.</p><p className="remote-note">연결 상태는 SSH 통신 상태입니다. Dot 화면 연결은 별도로 유지됩니다.</p></div>}
          {busy && <p role="status">요청 처리 중…</p>}
        </section>
      </ConfigSplitView>
    </ConfigPanelShell>
  </div>;
}
