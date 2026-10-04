"use client";
import { useCallback, useEffect, useState } from "react";
import { connectionRequest, type ConnectionSnapshot } from "@/lib/connections/client";
import type { SessionRef } from "@/lib/session-provider";
import type { RuntimeSessionSummary } from "@/lib/runtime/types";
export interface ExecutionGroup { id: string; label: string; state: "loading" | "connected" | "error"; backends: SessionRef["backend"][]; sessions: (RuntimeSessionSummary & SessionRef)[]; error?: string }
export function useExecutionGroups() {
  const [groups, setGroups] = useState<ExecutionGroup[]>([]);
  const load = useCallback(async (signal: AbortSignal) => {
    const connections = await connectionRequest<ConnectionSnapshot>(undefined, signal);
    const remote = [...connections.connections].sort((a, b) => (a.alias === "cocoamini" ? -2 : a.alias === "oracle" ? -1 : 0) - (b.alias === "cocoamini" ? -2 : b.alias === "oracle" ? -1 : 0));
    const definitions = [{ id: "local", label: "로컬 (웹 서버)" }, ...remote];
    if (!signal.aborted) setGroups(previous => definitions.map(definition => previous.find(group => group.id === definition.id) || { ...definition, state: "loading", backends: [], sessions: [] }));
    await Promise.allSettled(definitions.map(async definition => {
      const update = (group: ExecutionGroup) => { if (!signal.aborted) setGroups(previous => previous.map(item => item.id === definition.id ? group : item)); };
      try {
        const query = new URLSearchParams({ connectionId: definition.id, backend: "pi", action: "info" });
        const response = await fetch(`/api/runtime?${query}`, { signal, cache: "no-store" }); const info = await response.json();
        if (!response.ok) throw new Error(info.error || "연결 확인 실패");
        const backends = (["pi", "codex"] as const).filter(backend => info.agents[backend]);
        const results = await Promise.allSettled(backends.map(async backend => {
          const params = new URLSearchParams({ connectionId: definition.id, backend });
          const response = await fetch(`/api/runtime?${params}`, { signal, cache: "no-store" }); const result = await response.json();
          if (!response.ok) throw new Error(result.error || "세션 목록 조회 실패");
          return result.sessions.map((session: RuntimeSessionSummary) => ({ ...session, connectionId: definition.id, backend }));
        }));
        const sessions = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
        sessions.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
        const errors = results.flatMap(result => result.status === "rejected" ? [String(result.reason.message || result.reason)] : []);
        update({ ...definition, state: errors.length === results.length && errors.length ? "error" : "connected", backends, sessions, error: errors.join(" · ") || undefined });
      } catch (value) { update({ ...definition, state: "error", backends: [], sessions: [], error: value instanceof Error ? value.message : "연결 확인 실패" }); }
    }));
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let pending = false;
    const reload = () => { if (pending) return; pending = true; void load(controller.signal).catch(() => {}).finally(() => { pending = false; }); };
    reload(); const interval = setInterval(() => { if (!document.hidden) reload(); }, 10000);
    window.addEventListener("pi-web:connections-changed", reload); window.addEventListener("pi-web:runtime-updated", reload);
    return () => { controller.abort(); clearInterval(interval); window.removeEventListener("pi-web:connections-changed", reload); window.removeEventListener("pi-web:runtime-updated", reload); };
  }, [load]);
  return groups;
}
