"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DotSnapshot } from "@/packages/dot-client/core.mjs";
import type { DotEvent } from "@/packages/dot-client/server.mjs";
import { dotCommand, dotFetch } from "@/lib/dot/web-client";
import { DotError } from "@/packages/dot-client/core.mjs";

export function useDotConversation(threadId: string | null) {
  const [snapshot, setSnapshot] = useState<DotSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const version = ++generation.current;
    activeRequest.current?.abort();
    const abort = new AbortController();
    activeRequest.current = abort;
    setSnapshot(null); setError(null); setSending(false);
    if (!threadId) return () => abort.abort();
    const current = () => version === generation.current && !abort.signal.aborted;
    void dotFetch<DotSnapshot>(`/api/dot?threadId=${encodeURIComponent(threadId)}`, { signal: abort.signal })
      .then((data) => { if (current()) setSnapshot(data); })
      .catch((reason) => { if (current()) setError(reason instanceof Error ? reason.message : "Dot request failed."); });
    const source = new EventSource(`/api/dot/events?threadId=${encodeURIComponent(threadId)}`);
    source.onmessage = (message) => {
      if (!current()) return;
      try {
        const event = JSON.parse(message.data) as DotEvent;
        if (event.type === "snapshot") { setSnapshot(event.snapshot); setError(null); }
        else if (event.type === "error") setError("Dot refresh failed. Reconnecting…");
      } catch { setError("Dot returned an invalid event."); }
    };
    source.onerror = () => { if (current()) setError("Dot connection interrupted. Reconnecting…"); };
    return () => { abort.abort(); source.close(); };
  }, [threadId]);

  const send = useCallback(async (text: string, requestId: string) => {
    if (!threadId || sending) return false;
    const version = generation.current;
    const abort = activeRequest.current;
    if (!abort || abort.signal.aborted) return false;
    setSending(true); setError(null);
    let accepted = false;
    try {
      await dotCommand({ action: "send", threadId, text, requestId }, abort.signal);
      accepted = true;
      const updated = await dotFetch<DotSnapshot>(`/api/dot?threadId=${encodeURIComponent(threadId)}`, { signal: abort.signal });
      if (version === generation.current && !abort.signal.aborted) setSnapshot(updated);
      return true;
    } catch (reason) {
      if (version === generation.current && !abort.signal.aborted) {
        const message = reason instanceof Error ? reason.message : "Message request failed.";
        setError(accepted ? "Message accepted; conversation refresh was interrupted."
          : reason instanceof DotError && reason.deliveryUnknown ? `${message} Delivery is unknown; check the conversation before retrying.` : message);
      }
      return accepted;
    } finally { if (version === generation.current) setSending(false); }
  }, [threadId, sending]);

  return { snapshot, error, sending, send };
}
