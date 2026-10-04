"use client";
import { useState } from "react";
import type { RuntimeAnswer, RuntimeRequest } from "@/lib/runtime/types";

export function RuntimeRequestForm({ request, onReply }: { request: RuntimeRequest; onReply: (answer: RuntimeAnswer) => Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (answer: RuntimeAnswer) => { setBusy(true); setError(""); try { await onReply(answer); } catch (value) { setError(value instanceof Error ? value.message : "응답 실패"); setBusy(false); } };
  const permissions = request.method === "item/permissions/requestApproval";
  return <section role="dialog" aria-label={request.title} style={{ maxWidth: 1000, margin: "12px auto", padding: 16, border: "1px solid var(--border)", borderRadius: 8 }}>
    <strong>{request.title}</strong><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{request.detail}</pre>
    {request.kind === "question" ? <form onSubmit={event => { event.preventDefault(); void submit({ answers, value: answers.value }); }}>
      {request.questions?.map(question => <label key={question.id} style={{ display: "block", margin: "12px 0" }}>{question.question}
        {!!question.options?.length && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0" }}>{question.options.map(option => <button disabled={busy} type="button" key={option.label} title={option.description} onClick={() => setAnswers(value => ({ ...value, [question.id]: option.label }))}>{option.label}</button>)}</div>}
        <input type={question.isSecret ? "password" : "text"} required value={answers[question.id] || ""} disabled={busy} aria-label={question.question} onChange={event => setAnswers(value => ({ ...value, [question.id]: event.target.value }))} style={{ display: "block", width: "100%", padding: 8, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6 }} />
      </label>)}
      <button disabled={busy} type="submit">답변 보내기</button> <button disabled={busy} type="button" onClick={() => void submit({ cancelled: true })}>취소</button>
    </form> : <>
      <button disabled={busy} type="button" onClick={() => void submit({ decision: "accept" })}>{permissions ? "이번 실행에 요청 권한 승인" : "승인"}</button>
      {" "}<button disabled={busy} type="button" onClick={() => void submit({ decision: "decline" })}>{permissions ? "권한 부여 없이 계속" : "거절"}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
