"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ComputerSession, type ComputerState } from "@/packages/dot-client/browser.mjs";
import { browserKeysym, videoCoordinates } from "@/packages/dot-client/core.mjs";
import { dotCommand } from "@/lib/dot/web-client";
import { useI18n } from "@/hooks/useI18n";

export function DotComputerPanel({ threadId, ready, active = true }: { threadId: string; ready: boolean; active?: boolean }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const pressedKeys = useRef(new Map<string, number>());
  const [state, setState] = useState<ComputerState>({ connection: "disconnected", controlling: false, stream: null, error: null });
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const computer = useMemo(() => new ComputerSession(async (offer, signal) => {
    const response = await dotCommand<{ sdp: string }>({ action: "computer", threadId, offer }, signal);
    return response.sdp;
  }), [threadId]);

  useEffect(() => {
    if (!state.controlling) pressedKeys.current.clear();
  }, [state.controlling]);
  useEffect(() => { if (!active) computer.releaseControl(); }, [active, computer]);
  useEffect(() => {
    const stop = computer.subscribe(setState);
    return () => { stop(); computer.close(); };
  }, [computer]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = state.stream;
    if (state.stream) void element.play().catch(() => {});
    return () => { element.srcObject = null; };
  }, [state.stream]);
  useEffect(() => {
    const release = () => { computer.releaseControl(); };
    const hidden = () => { if (document.hidden) release(); };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("blur", release); document.removeEventListener("visibilitychange", hidden); };
  }, [computer]);

  const action = async (operation: () => void | Promise<void>) => {
    setError(null);
    try { await operation(); } catch (reason) { setError(reason instanceof Error ? reason.message : t("dot.failed")); }
  };
  const click = (event: React.MouseEvent<HTMLVideoElement>, button = 1) => {
    if (!state.controlling) return;
    event.preventDefault();
    const element = event.currentTarget;
    const bounds = element.getBoundingClientRect();
    const point = videoCoordinates(event.clientX - bounds.left, event.clientY - bounds.top,
      bounds.width, bounds.height, element.videoWidth, element.videoHeight);
    if (point) void action(() => computer.click(point.x, point.y, button));
  };
  const key = (event: React.KeyboardEvent<HTMLVideoElement>, down: boolean) => {
    if (!state.controlling || event.nativeEvent.isComposing || event.repeat) return;
    const physicalKey = event.code || event.key;
    const symbol = down ? browserKeysym(event.key) : pressedKeys.current.get(physicalKey) ?? browserKeysym(event.key);
    if (symbol === null) return;
    event.preventDefault();
    if (down) pressedKeys.current.set(physicalKey, symbol); else pressedKeys.current.delete(physicalKey);
    void action(() => computer.key(symbol, down));
  };

  return <section className="dot-computer" aria-label={t("dot.computer")}>
    <div className="dot-toolbar">
      <strong>{t("dot.computer")}</strong>
      <span className="dot-state" aria-live="polite">{t(`dot.state.${state.connection}`)}</span>
      {state.connection === "disconnected" || state.connection === "failed"
        ? <button disabled={!ready} onClick={() => void action(() => computer.connect())}>{t("dot.connect")}</button>
        : <button onClick={() => computer.close()}>{t("dot.disconnect")}</button>}
      <button disabled={state.connection !== "connected" || requesting} aria-pressed={state.controlling}
        onClick={() => {
          if (state.controlling) { computer.releaseControl(); return; }
          setRequesting(true);
          void action(() => computer.requestControl()).finally(() => setRequesting(false));
        }}>{state.controlling ? t("dot.release") : requesting ? t("dot.requesting") : t("dot.control")}</button>
    </div>
    {!ready && <p className="dot-note">{t("dot.notReady")}</p>}
    <div className="dot-video-area">
      {!state.stream && <div className="dot-video-placeholder">{t("dot.connectHint")}</div>}
      <video ref={video} autoPlay muted playsInline tabIndex={state.controlling ? 0 : -1}
        aria-label={t("dot.remoteScreen")} className={state.controlling ? "is-controlled" : ""}
        onClick={(event) => click(event)} onContextMenu={(event) => click(event, 3)}
        onAuxClick={(event) => { if (event.button === 1) click(event, 2); }}
        onKeyDown={(event) => key(event, true)} onKeyUp={(event) => key(event, false)}
        onBlur={() => computer.releaseControl()}
        onWheel={(event) => {
          if (!state.controlling) return;
          void action(() => computer.wheel(-Math.sign(event.deltaX) * 10, -Math.sign(event.deltaY) * 10));
        }} />
    </div>
    {state.controlling && <p className="dot-note">{t("dot.controlHint")}</p>}
    {(error || state.error) && <p className="dot-error" role="alert">{error || state.error}</p>}
  </section>;
}
