"use client";
import { useEffect, useRef, useState } from "react";
import { ConfigPanelShell, ConfigButton } from "../SettingsUi";
import { openStackedDialog } from "@/lib/stacked-dialog";
import type { SessionRef } from "@/lib/session-provider";
export function NewRuntimeSession({ label, backends, backend, onBackendChange, models, busy, error, onCreate, onClose }: { label: string; backends: SessionRef["backend"][]; backend: SessionRef["backend"]; onBackendChange: (backend: SessionRef["backend"]) => void; models: { id: string; name: string }[]; busy: boolean; error: string; onCreate: (cwd: string, model?: string) => Promise<boolean>; onClose: () => void }) {
  const [cwd, setCwd] = useState("~"); const [model, setModel] = useState(""); const panel = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => openStackedDialog(document, panel.current, () => close.current()), []);
  return <div ref={panel} tabIndex={-1}><ConfigPanelShell embedded={false} title={`새 스레드 · ${label}`} onClose={onClose} width={520} height="auto">
    <form style={{ padding: 20 }} onSubmit={event => { event.preventDefault(); void onCreate(cwd, model || undefined).then(created => { if (created) onClose(); }); }}>
      {backends.length > 1 && <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>{backends.map(value => <label key={value}><input type="radio" name="engine" value={value} checked={backend === value} disabled={busy} onChange={() => { setModel(""); onBackendChange(value); }} /> {value === "pi" ? "Pi" : "Codex"}</label>)}</div>}
      <label style={{ display: "block", marginBottom: 14 }}>작업 폴더<input aria-label="작업 폴더" value={cwd} onChange={event => setCwd(event.target.value)} required style={{ display: "block", width: "100%", marginTop: 7, padding: 9, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6 }} /></label>
      {!!models.length && <label style={{ display: "block", marginBottom: 14 }}>모델<select aria-label="모델" value={model} onChange={event => setModel(event.target.value)} style={{ display: "block", width: "100%", marginTop: 7, padding: 9, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)" }}><option value="">서버 기본 설정</option>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {error && <p role="alert" style={{ color: "#e76c6c" }}>{error}</p>}
      <ConfigButton type="submit" variant="primary" disabled={busy}>{busy ? "생성 중…" : "생성"}</ConfigButton>
    </form>
  </ConfigPanelShell></div>;
}
