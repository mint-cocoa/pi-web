"use client";
import { useEffect, useRef, useState } from "react";
import { connectionRequest, type ConnectionSnapshot, type RemoteSelection } from "@/lib/connections/client";
import type { RemoteTranscript } from "@/lib/connections/types";

export function RemoteSessionView({ selection, onClose }: { selection: RemoteSelection; onClose: () => void }) {
  const [data, setData] = useState<RemoteTranscript>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    const controller = new AbortController();
    setData(undefined); setError(""); setLoading(true);
    const load = async () => {
      const snapshot = await connectionRequest<ConnectionSnapshot>(undefined, controller.signal);
      const connection = snapshot.connections.find(item => item.id === selection.connection.id);
      if (!connection || connection.alias !== selection.connection.alias) throw new Error("연결 등록이 변경되었습니다. 사이드바에서 다시 선택하세요.");
      if (connection.state !== "connected") throw new Error("SSH 연결이 해제되었습니다. 사이드바에서 서버에 연결한 뒤 새로고침하세요.");
      if (!connection.inventory?.sessions.some(item => item.id === selection.session.id && item.backend === selection.session.backend)) throw new Error("현재 목록에서 세션을 찾지 못했습니다. 서버 목록을 새로고침하세요.");
      const transcript = await connectionRequest<RemoteTranscript>({ action: "transcript", id: connection.id, sessionId: selection.session.id }, controller.signal);
      if (!controller.signal.aborted) setData(transcript);
    };
    void load().catch(value => { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "세션 조회 실패"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selection, revision]);
  return <section className="remote-session-view" ref={panel} tabIndex={-1} aria-label="원격 세션 대화" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); onClose(); }
  }}>
    <header><div><small>{selection.connection.label} · {selection.session.backend} · 읽기 전용</small><h2>{selection.session.title}</h2><p>{selection.session.cwd}</p></div>
      <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>새로고침</button><button type="button" onClick={onClose}>로컬로 돌아가기</button>
    </header>
    <div className="remote-session-body">
      {loading && <p role="status">원격 대화 불러오는 중…</p>}
      {error && <p role="alert">{error}</p>}
      {data?.truncated && <p className="connection-nav-note">일부 기록만 표시됩니다. 대화 메시지 최대 100개.</p>}
      {data?.messages.map((message, index) => <article className={"remote-message is-" + message.role} key={index}><small>{message.role === "user" ? "사용자" : "어시스턴트"}</small><pre>{message.text}</pre></article>)}
      {data && !data.messages.length && <p>저장된 대화 메시지가 없습니다.</p>}
    </div>
    <footer>원격 세션 기록 조회 · 이 화면에서는 메시지나 컴퓨터 명령을 보내지 않습니다.</footer>
  </section>;
}
