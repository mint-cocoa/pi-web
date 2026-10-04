"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Dot } from "@/packages/dot-client/core.mjs";
import { dotFetch } from "@/lib/dot/web-client";
import { useDotConversation } from "@/hooks/useDotConversation";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { DotComputerPanel } from "./DotComputerPanel";

export function DotWorkspace({ embedded = false, active = true }: { embedded?: boolean; active?: boolean } = {}) {
  useTheme();
  const { t } = useI18n();
  const search = useSearchParams();
  const [dots, setDots] = useState<Dot[]>([]);
  const [threadId, setThreadId] = useState<string | null>(embedded ? null : search.get("threadId"));
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const request = useRef<{ text: string; threadId: string; id: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);
  const { snapshot, error, sending, send } = useDotConversation(threadId);
  const lastMessageId = snapshot?.messages.at(-1)?.id;

  useEffect(() => {
    const abort = new AbortController();
    void dotFetch<Dot[]>("/api/dot", { signal: abort.signal }).then((value) => {
      setDots(value); setThreadId((current) => current ?? value[0]?.threadId ?? null);
    }).catch((reason) => {
      if (!abort.signal.aborted) setListError(reason instanceof Error ? reason.message : t("dot.failed"));
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [t]);
  useEffect(() => { if (autoScroll.current) end.current?.scrollIntoView({ block: "end" }); }, [lastMessageId]);

  const submit = async () => {
    if (!threadId || !draft.trim() || sending) return;
    if (request.current?.text !== draft || request.current.threadId !== threadId) {
      request.current = { text: draft, threadId, id: crypto.randomUUID() };
    }
    const submitted = request.current;
    if (await send(draft, submitted.id) && request.current === submitted) { setDraft(""); request.current = null; }
  };
  const ready = snapshot?.environment.capabilities.some((capability) => capability.type === "remote_desktop" && capability.status === "ready") ?? false;

  const Root = embedded ? "section" : "main";
  return <Root className={`dot-workspace${embedded ? " is-embedded" : ""}`} aria-label={t("dot.title")}>
    <header className="dot-header">
      {!embedded && <Link href="/">← {t("dot.back")}</Link>}
      {!embedded && <h1>{t("dot.title")}</h1>}
      <label>{t("dot.select")}
        <select aria-label={t("dot.select")} value={threadId ?? ""} onChange={(event) => {
          setThreadId(event.target.value); setDraft(""); request.current = null; autoScroll.current = true;
          if (!embedded) window.history.replaceState(null, "", `/dot?threadId=${encodeURIComponent(event.target.value)}`);
        }} disabled={!dots.length}>
          {!dots.length && <option value="">{loading ? t("dot.loading") : t("dot.empty")}</option>}
          {dots.map((dot) => <option key={dot.threadId} value={dot.threadId}>{dot.name}</option>)}
          {threadId && !dots.some((dot) => dot.threadId === threadId) && <option value={threadId}>{snapshot?.dot.name ?? t("dot.title")}</option>}
        </select>
      </label>
    </header>
    {listError && <p className="dot-error" role="alert">{listError}</p>}
    <div className="dot-grid">
      <section className="dot-chat" aria-label={t("dot.chat")}>
        <div className="dot-toolbar"><strong>{snapshot?.dot.name ?? t("dot.chat")}</strong><span>{t("dot.subscription")}</span></div>
        <div className="dot-messages" aria-label={t("dot.messages")} onScroll={(event) => {
          const element = event.currentTarget;
          autoScroll.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
        }}>
          {!snapshot?.messages.length && <p className="dot-note">{threadId ? t("dot.waiting") : t("dot.empty")}</p>}
          {snapshot?.messages.map((message) => <article key={message.id} className={`dot-message ${message.role}`}>
            <div className="dot-message-meta">{message.authorName ?? (message.role === "user" ? t("dot.you") : snapshot.dot.name)}
              {message.createdAt && <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString()}</time>}
            </div>
            <div className="dot-message-body">{message.text}</div>
            {message.truncated && <small>{t("dot.truncated")}</small>}
          </article>)}
          <div ref={end} />
        </div>
        {error && <p role="alert" className="dot-error">{error}</p>}
        <form className="dot-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <textarea aria-label={t("dot.message")} placeholder={t("dot.message")} value={draft} maxLength={16000}
            disabled={!threadId || sending} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" disabled={!snapshot || !draft.trim() || sending}>{sending ? t("dot.sending") : t("dot.send")}</button>
        </form>
      </section>
      {threadId ? <DotComputerPanel key={threadId} threadId={threadId} ready={ready} active={active} />
        : <section className="dot-computer"><p className="dot-note">{t("dot.selectHint")}</p></section>}
    </div>
  </Root>;
}
