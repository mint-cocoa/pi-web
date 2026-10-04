"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionRef } from "@/lib/session-provider";
import { SessionController } from "@/lib/runtime/controller";
import type { RuntimeSessionSummary, RuntimeTarget } from "@/lib/runtime/types";
export function useExecutionWorkspace() {
  const [target, setTargetState] = useState<RuntimeTarget>({ connectionId: "local", backend: "pi" });
  const [initialized, setInitialized] = useState(false);
  const [selection, setSelection] = useState<SessionRef | null>(null);
  const [sessions, setSessions] = useState<RuntimeSessionSummary[]>([]);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState(""); const [creating, setCreating] = useState(false);
  const currentTarget = useRef(target); currentTarget.current = target;
  const receipt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const setTarget = useCallback((next: RuntimeTarget) => { setSelection(null); setTargetState(next); }, []);
  const select = useCallback((ref: SessionRef) => { setTargetState({ connectionId: ref.connectionId, backend: ref.backend }); setSelection(ref); }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("pi-web.execution-workspace.v1") || "null");
      if (saved?.target && typeof saved.target.connectionId === "string" && ["pi", "codex"].includes(saved.target.backend)) {
        setTargetState(saved.target);
        if (saved.selection?.connectionId === saved.target.connectionId && saved.selection?.backend === saved.target.backend && typeof saved.selection.id === "string") setSelection(saved.selection);
      }
    } catch { /* Storage is best effort. */ }
    setInitialized(true);
  }, []);
  useEffect(() => { if (initialized) try { sessionStorage.setItem("pi-web.execution-workspace.v1", JSON.stringify({ target, selection })); } catch { /* Storage is best effort. */ } }, [initialized, target, selection]);
  const reload = useCallback(async (signal?: AbortSignal) => {
    const query = new URLSearchParams({ ...target });
    const response = await fetch(`/api/runtime?${query}`, { signal, cache: "no-store" }); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "세션 목록 조회 실패");
    if (!signal?.aborted && currentTarget.current.connectionId === target.connectionId && currentTarget.current.backend === target.backend) { setSessions(data.sessions); setError(""); }
  }, [target]);
  useEffect(() => {
    if (!initialized) return;
    const controller = new AbortController(); setSessions([]); setModels([]);
    void reload(controller.signal).catch(value => { if (!controller.signal.aborted) setError(value.message); });
    const query = new URLSearchParams({ ...target, action: "models" });
    void fetch(`/api/runtime?${query}`, { signal: controller.signal }).then(response => response.json()).then(data => { if (!controller.signal.aborted) setModels(data.models || []); }).catch(() => {});
    const interval = setInterval(() => { if (!document.hidden) void reload(controller.signal).catch(() => {}); }, 5000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [initialized, reload, target]);
  const create = async (cwd: string, model?: string) => {
    setCreating(true); setError("");
    const fingerprint = JSON.stringify([target, cwd, model]);
    if (receipt.current?.fingerprint !== fingerprint) receipt.current = { fingerprint, requestId: crypto.randomUUID() };
    try { const snapshot = await SessionController.create(target, cwd, model, receipt.current.requestId); if (currentTarget.current.connectionId === target.connectionId && currentTarget.current.backend === target.backend) { setSelection(snapshot.ref); await reload(); } window.dispatchEvent(new Event("pi-web:runtime-updated")); receipt.current = null; return true; }
    catch (value) { setError(value instanceof Error ? value.message : "생성 실패"); return false; }
    finally { setCreating(false); }
  };
  return { target, setTarget, select, selection, setSelection, sessions, models, error, creating, create, reload };
}
