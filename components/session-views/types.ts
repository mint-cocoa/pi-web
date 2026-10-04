import type { ReactNode } from "react";
import type { SessionSelection, SessionProvider } from "@/lib/session-provider";
import type { NavigationSession } from "@/lib/connections/navigation";
import type { SessionViewAdapter } from "@/lib/session-view";

export interface SessionRowContext { session: NavigationSession; provider: SessionProvider; actions: ReactNode; activate: () => void }
export interface SessionConversationContext { selection: SessionSelection; onClose: () => void }
export type SessionRowRenderer = (context: SessionRowContext) => ReactNode;
export type SessionConversationRenderer = (context: SessionConversationContext) => ReactNode;
export type SessionUiAdapter = SessionViewAdapter<SessionRowRenderer, SessionConversationRenderer>;
