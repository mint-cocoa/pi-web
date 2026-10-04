"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectionRequest, type ConnectionSnapshot } from "@/lib/connections/client";
import type { RemoteConnection, RemoteInventory } from "@/lib/connections/types";

interface CachedConnection extends RemoteConnection { cachedInventory?: RemoteInventory }
/** Read-only polling never starts SSH. Cached titles remain in memory after disconnect. */
export function useConnectionNavigation() {
  const [connections, setConnections] = useState<CachedConnection[]>([]);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  const reload = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    const snapshot = await connectionRequest<ConnectionSnapshot>(undefined, signal);
    if (signal?.aborted || sequence !== requestSequence.current) return;
    setConnections(previous => snapshot.connections.map(connection => ({ ...connection,
      cachedInventory: connection.inventory || previous.find(item => item.id === connection.id && item.alias === connection.alias)?.cachedInventory,
    })));
    setError("");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try { await reload(controller.signal); }
      catch (value) { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "연결 목록 조회 실패"); }
      finally { inFlight = false; }
    };
    void refresh();
    const interval = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    const changed = () => { void refresh(); };
    window.addEventListener("pi-web:connections-changed", changed);
    document.addEventListener("visibilitychange", changed);
    return () => { controller.abort(); clearInterval(interval); window.removeEventListener("pi-web:connections-changed", changed); document.removeEventListener("visibilitychange", changed); };
  }, [reload]);
  return { connections, error, reload };
}
