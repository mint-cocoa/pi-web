"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { DotWorkspace } from "./DotWorkspace";
import { constrainFloatingRect, defaultFloatingRect, type FloatingRect } from "./floating-geometry";
import "@/app/dot/dot.css";

const STORAGE_KEY = "pi-web:dot-window:v1";
function initialRect(): FloatingRect {
  if (typeof window === "undefined") return defaultFloatingRect(1280, 900);
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (stored && typeof stored === "object") return constrainFloatingRect(stored, window.innerWidth, window.innerHeight);
  } catch { /* Optional preference. */ }
  return defaultFloatingRect(window.innerWidth, window.innerHeight);
}

export function DotFloatingPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [rect, setRect] = useState(initialRect);
  const [minimized, setMinimized] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ kind: "move" | "resize"; x: number; y: number; rect: FloatingRect } | null>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rect)); } catch { /* Optional preference. */ }
  }, [rect]);
  useEffect(() => {
    const resize = () => setRect((current) => constrainFloatingRect(current, window.innerWidth, window.innerHeight));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const begin = (event: React.PointerEvent<HTMLElement>, kind: "move" | "resize") => {
    if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest("button,a,select")) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind, x: event.clientX, y: event.clientY, rect };
  };
  const move = (event: React.PointerEvent<HTMLElement>) => {
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    const next = start.kind === "move" ? { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy }
      : { ...start.rect, width: start.rect.width + dx, height: start.rect.height + dy };
    setRect(minimized && start.kind === "move" ? { ...next,
      x: Math.min(Math.max(12, window.innerWidth - Math.min(320, next.width) - 12), Math.max(12, next.x)),
      y: Math.min(Math.max(12, window.innerHeight - 56), Math.max(12, next.y)),
    } : constrainFloatingRect(next, window.innerWidth, window.innerHeight));
  };
  const end = () => { drag.current = null; };
  return <section ref={panel} tabIndex={-1} className={`dot-floating-panel${minimized ? " is-minimized" : ""}`} role="dialog"
    aria-modal="false" aria-label={t("dot.window")} style={{ left: rect.x, top: rect.y, width: minimized ? Math.min(320, rect.width) : rect.width, height: minimized ? 44 : rect.height }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape" && !event.defaultPrevented && !["VIDEO", "TEXTAREA", "INPUT"].includes((event.target as HTMLElement).tagName)) {
        event.preventDefault(); onClose();
      }
    }}>
    <div className="dot-floating-titlebar" tabIndex={-1} onPointerDown={(event) => begin(event, "move")}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <span className="dot-floating-title" tabIndex={0} role="button" aria-label={t("dot.moveWindow")}
        onKeyDown={(event) => {
          const deltas: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
          const delta = deltas[event.key];
          if (delta) { event.preventDefault(); setRect(constrainFloatingRect({ ...rect, x: rect.x + delta[0], y: rect.y + delta[1] }, window.innerWidth, window.innerHeight)); }
        }}>◉ {t("dot.title")}</span>
      <a href="/dot" target="_blank" rel="noreferrer" aria-label={t("dot.openPage")} title={t("dot.openPage")}>↗</a>
      <button type="button" onClick={() => {
        if (minimized) setRect((current) => constrainFloatingRect(current, window.innerWidth, window.innerHeight));
        setMinimized((value) => !value);
      }} aria-label={t(minimized ? "dot.restoreWindow" : "dot.minimizeWindow")}
        title={t(minimized ? "dot.restoreWindow" : "dot.minimizeWindow")}>{minimized ? "□" : "−"}</button>
      <button type="button" onClick={onClose} aria-label={t("dot.closeWindow")} title={t("dot.closeWindow")}>×</button>
    </div>
    <div className="dot-floating-body" hidden={minimized} inert={minimized}><DotWorkspace embedded active={!minimized} /></div>
    {!minimized && <div className="dot-floating-resize" role="button" tabIndex={0} aria-label={t("dot.resizeWindow")}
      onPointerDown={(event) => begin(event, "resize")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onKeyDown={(event) => {
        if (!event.key.startsWith("Arrow")) return;
        event.preventDefault();
        setRect(constrainFloatingRect({ ...rect, width: rect.width + (event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0),
          height: rect.height + (event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0) }, window.innerWidth, window.innerHeight));
      }} />}
  </section>;
}
