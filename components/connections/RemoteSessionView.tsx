"use client";
import { useEffect, useRef, useState } from "react";
import type { SessionSelection, SessionTranscript } from "@/lib/session-provider";

export function SessionTranscriptView({ selection, onClose }: { selection: SessionSelection; onClose: () => void }) {
  const [data, setData] = useState<SessionTranscript>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    const controller = new AbortController();
    setData(undefined); setError(""); setLoading(true);
    const load = async () => {
      const transcript = await selection.provider.read(selection.ref, controller.signal);
      if (!controller.signal.aborted) setData(transcript);
    };
    void load().catch(value => { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "세션 조회 실패"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selection, revision]);
  return <section className="remote-session-view" ref={panel} tabIndex={-1} aria-label="원격 세션 대화" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); onClose(); }
  }}>
    <header><div><small>{selection.provider.connection.label} · {selection.ref.backend} · 읽기 전용</small><h2>{selection.summary.title}</h2><p>{selection.summary.cwd}</p></div>
      <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>새로고침</button><button type="button" onClick={onClose}>로컬로 돌아가기</button>
    </header>
    <div className="remote-session-body">
      {loading && <p role="status">원격 대화 불러오는 중…</p>}
      {error && <p role="alert">{error}</p>}
      {data?.truncated && <p className="connection-nav-note">일부 기록만 표시됩니다. 대화 메시지 최대 100개.</p>}
      {data?.messages.map((message, index) => <article className={"remote-message is-" + message.role} key={index}><small>{message.role === "user" ? "사용자" : message.role === "assistant" ? "어시스턴트" : message.role}</small><pre>{message.text}</pre></article>)}
      {data && !data.messages.length && <p>저장된 대화 메시지가 없습니다.</p>}
    </div>
    <footer>원격 세션 기록 조회 · 이 화면에서는 메시지나 컴퓨터 명령을 보내지 않습니다.</footer>
  </section>;
}
