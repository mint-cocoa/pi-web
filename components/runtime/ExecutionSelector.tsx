"use client";
import { useEffect, useState } from "react";
import type { RuntimeTarget } from "@/lib/runtime/types";
import { connectionRequest, type ConnectionSnapshot } from "@/lib/connections/client";
export function ExecutionSelector({ target, onChange }: { target: RuntimeTarget; onChange: (target: RuntimeTarget) => void }) {
  const [connections, setConnections] = useState<ConnectionSnapshot["connections"]>([]);
  useEffect(() => { const controller = new AbortController(); const reload = () => { void connectionRequest<ConnectionSnapshot>(undefined, controller.signal).then(value => { if (!controller.signal.aborted) setConnections(value.connections); }).catch(() => {}); }; reload(); window.addEventListener("pi-web:connections-changed", reload); return () => { controller.abort(); window.removeEventListener("pi-web:connections-changed", reload); }; }, []);
  const style = { width: "100%", color: "var(--text)", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 12 };
  return <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
    <select aria-label="실행 컴퓨터" value={target.connectionId} onChange={event => onChange({ ...target, connectionId: event.target.value })} style={style}>
      <option value="local">로컬 (웹 서버)</option>{connections.map(connection => <option value={connection.id} key={connection.id}>{connection.label}</option>)}
    </select>
    <select aria-label="실행 엔진" value={target.backend} onChange={event => onChange({ ...target, backend: event.target.value as RuntimeTarget["backend"] })} style={{ ...style, width: 85 }}><option value="pi">Pi</option><option value="codex">Codex</option></select>
  </div>;
}
