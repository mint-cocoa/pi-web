"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionRef } from "@/lib/session-provider";
import { useSessionController } from "@/hooks/useSessionController";
import { MessageView } from "../MessageView";
import { ChatInput, type ChatInputHandle } from "../ChatInput";
import { RuntimeRequestForm } from "./RuntimeRequestForm";
import type { ToolResultMessage } from "@/lib/types";
export function RuntimeChatWindow({ session, onClose, onUpdated }: { session: SessionRef; onClose: () => void; onUpdated: () => void }) {
  const { snapshot, error, send, interrupt, reply } = useSessionController(session);
  const [sending, setSending] = useState(false); const bottom = useRef<HTMLDivElement>(null);
  const draftKey = `runtime:${session.connectionId}:${session.backend}:${session.id}`;
  const input = useRef<ChatInputHandle>(null);
  const toolResults = useMemo(() => new Map((snapshot?.messages || []).filter((message): message is ToolResultMessage => message.role === "toolResult").map(message => [message.toolCallId, message])), [snapshot?.messages]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [snapshot?.messages.length]);
  const busy = sending || snapshot?.phase === "running" || snapshot?.phase === "approval";
  return <div style={{ height: "100%", display: "flex", flexDirection: "column" }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape" && busy) { event.preventDefault(); void interrupt().catch(() => {}); } }}>
    <header style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center" }}>
      <span style={{ flex: 1 }}>{snapshot?.title || "세션 연결 중…"} <small style={{ color: "var(--text-muted)" }}>{session.backend} · {snapshot?.phase || "loading"}</small></span>
      <button type="button" onClick={onClose}>닫기</button>
    </header>
    {(error || snapshot?.error) && <div role="alert" style={{ padding: "10px 16px", color: "#e76c6c" }}>{error || snapshot?.error}</div>}
    <div style={{ flex: 1, overflowY: "auto", padding: "16px", minHeight: 0 }}>
      {snapshot?.messages.map((message, index) => <div key={index} style={{ maxWidth: 1000, margin: "0 auto 16px" }}><MessageView message={message} toolResults={toolResults} isStreaming={busy && index === snapshot.messages.length - 1 && message.role === "assistant"} /></div>)}
      {snapshot?.requests.map(request => <RuntimeRequestForm key={String(request.id)} request={request} onReply={answer => reply(request.id, answer)} />)}
      <div ref={bottom} />
    </div>
    <div style={{ borderTop: "1px solid var(--border)", padding: 12 }}>
      <ChatInput ref={input} compact draftKey={draftKey} model={snapshot?.model} onSend={message => { setSending(true); void send(message).then(onUpdated).catch(() => input.current?.restoreSubmission(message, undefined, draftKey)).finally(() => setSending(false)); }} onAbort={() => void interrupt().catch(() => {})} isStreaming={Boolean(busy || !snapshot)} />
    </div>
  </div>;
}
