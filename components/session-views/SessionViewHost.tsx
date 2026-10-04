"use client";
import { useMemo, type ReactNode } from "react";
import type { SessionSelection } from "@/lib/session-provider";
import { sessionRefKey } from "@/lib/session-provider";
import { SessionViewRegistry } from "@/lib/session-view";
import { SessionTranscriptView } from "../connections/RemoteSessionView";
import type { SessionUiAdapter } from "./types";

const DEFAULT_ADAPTERS: readonly SessionUiAdapter[] = [
  { id: "native-pi", target: { connectionId: "local", backend: "pi" }, mode: "native" },
  { id: "transcript", mode: "overlay", conversation: context => <SessionTranscriptView key={`${sessionRefKey(context.selection.ref)}:${context.selection.provider.connection.alias}`} selection={context.selection} onClose={context.onClose} /> },
];

/** Keeps the native view mounted while another adapter displays its view. */
export function SessionViewHost({ selection, onClose, adapters = DEFAULT_ADAPTERS, children }: {
  selection: SessionSelection | null; onClose: () => void; adapters?: readonly SessionUiAdapter[]; children: ReactNode;
}) {
  const registry = useMemo(() => new SessionViewRegistry(adapters), [adapters]);
  const adapter = selection ? registry.resolve(selection.ref) : undefined;
  const overlay = Boolean(selection && adapter?.mode === "overlay");
  return <>
    {overlay && selection && adapter?.conversation?.({ selection, onClose })}
    <div inert={overlay} style={{ display: overlay ? "none" : "contents" }}>{children}</div>
  </>;
}
