"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SessionController } from "@/lib/runtime/controller";
import { sessionRefKey, type SessionRef } from "@/lib/session-provider";
import type { RuntimeAnswer, RuntimeSnapshot } from "@/lib/runtime/types";
import { mergeRuntimeSnapshot } from "@/lib/runtime/snapshot";
export function useSessionController(ref: SessionRef) {
  const key = sessionRefKey(ref);
  const { connectionId, backend, id } = ref;
  const controller = useMemo(() => new SessionController({ connectionId, backend, id }), [connectionId, backend, id]);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(); const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const sequence = ++generation.current; let alive = true; setSnapshot(undefined); setError("");
    const apply = (value: RuntimeSnapshot) => { if (alive && sequence === generation.current && sessionRefKey(value.ref) === key) { setSnapshot(previous => mergeRuntimeSnapshot(previous, value)); setError(""); } };
    const reload = () => { void controller.open().then(apply).catch(value => { if (alive) setError(value.message); }); };
    reload(); const dispose = controller.subscribe(apply, () => { if (alive) setError("연결 복구 중… 원격 실행은 계속될 수 있습니다."); });
    const interval = setInterval(() => { if (!document.hidden) reload(); }, 5000);
    return () => { alive = false; dispose(); clearInterval(interval); };
  }, [controller, key]);
  const command = useCallback(async (run: () => Promise<RuntimeSnapshot>) => { const sequence = generation.current; try { const value = await run(); if (sequence === generation.current && sessionRefKey(value.ref) === key) { setSnapshot(previous => mergeRuntimeSnapshot(previous, value)); setError(""); } } catch (value) { if (sequence === generation.current) setError(value instanceof Error ? value.message : "명령 처리 실패"); throw value; } }, [key]);
  return { snapshot, error, controller, send: (message: string) => command(() => controller.send(message)), interrupt: () => command(() => controller.interrupt()), reply: (id: string | number, answer: RuntimeAnswer) => command(() => controller.reply(id, answer)) };
}
