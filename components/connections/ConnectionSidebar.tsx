"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConnectionNavigation } from "@/hooks/useConnectionNavigation";
import { connectionRequest } from "@/lib/connections/client";
import { SessionProviderRegistry, type SessionSelection } from "@/lib/session-provider";
import { createLocalPiProvider, createSshSessionProvider } from "@/lib/session-provider-adapters";
import { buildNavigation, DEFAULT_NAVIGATION, isNavigationArchived, isNavigationPinned, navigationKey,
  NAVIGATION_STORAGE_KEY, readNavigationPreferences, toggleNavigationArchive, toggleNavigationPin, type NavigationPreferences, type NavigationSession } from "@/lib/connections/navigation";

export function ConnectionSidebar({ localSessions, selectedSession, query = "", onSelectSession, onManageConnections, renderInteractive, renderLocalGroup }: {
  localSessions: NavigationSession[];
  selectedSession?: SessionSelection | null;
  query?: string;
  onSelectSession: (selection: SessionSelection) => void;
  onManageConnections: () => void;
  renderInteractive: (session: NavigationSession, actions: ReactNode, activate: () => void) => ReactNode;
  renderLocalGroup: (children: ReactNode) => ReactNode;
}) {
  const { connections, error, reload } = useConnectionNavigation();
  const [prefs, setPrefs] = useState<NavigationPreferences>({ ...DEFAULT_NAVIGATION });
  const prefsRef = useRef(prefs);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [operationError, setOperationError] = useState("");
  useEffect(() => {
    const restore = () => {
      let next = { ...DEFAULT_NAVIGATION };
      try { next = readNavigationPreferences(localStorage.getItem(NAVIGATION_STORAGE_KEY)); } catch {}
      prefsRef.current = next; setPrefs(next);
    };
    restore();
    const storage = (event: StorageEvent) => { if (event.key === NAVIGATION_STORAGE_KEY) restore(); };
    window.addEventListener("storage", storage);
    return () => window.removeEventListener("storage", storage);
  }, []);
  function update(change: (value: NavigationPreferences) => NavigationPreferences) {
    const next = change(prefsRef.current); prefsRef.current = next; setPrefs(next);
    try { localStorage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify(next)); } catch {}
  }
  const providers = useMemo(() => [createLocalPiProvider(() => localSessions), ...connections.flatMap(connection => {
    const sessions = (connection.inventory || connection.cachedInventory)?.sessions.map(session => ({ ...session, connectionId: connection.id })) || [];
    return (["pi", "codex"] as const).map(backend => createSshSessionProvider({ id: connection.id, alias: connection.alias, label: connection.label }, backend, () => sessions.filter(session => session.backend === backend)));
  })], [connections, localSessions]);
  const registry = useMemo(() => new SessionProviderRegistry(providers), [providers]);
  const groups = useMemo(() => {
    const byConnection = new Map<string, { id: string; alias: string; label: string; sessions: NavigationSession[] }>();
    for (const provider of providers) {
      const connection = provider.connection;
      const group = byConnection.get(connection.id) || { ...connection, sessions: [] };
      group.sessions.push(...provider.catalog()); byConnection.set(connection.id, group);
    }
    return [...byConnection.values()];
  }, [providers]);
  const navigation = useMemo(() => buildNavigation(groups, prefs, query), [groups, prefs, query]);
  async function operate(id: string, action: "connect" | "disconnect" | "refresh") {
    setBusy(id); setMenu(undefined); setOperationError("");
    try { await connectionRequest({ action, id }); await reload(); }
    catch (value) { setOperationError(value instanceof Error ? value.message : "원격 연결 요청 실패"); }
    finally { setBusy(undefined); }
  }
  function move(id: string, delta: number) {
    const order = navigation.groups.filter(group => group.id !== "local").map(group => group.id);
    const index = order.indexOf(id), other = index + delta;
    if (index < 0 || other < 0 || other >= order.length) return;
    [order[index], order[other]] = [order[other], order[index]];
    update(value => ({ ...value, order }));
    setMenu(undefined);
  }
  function actions(session: NavigationSession) {
    const pinned = isNavigationPinned(session, prefs), archived = isNavigationArchived(session, prefs);
    return <span className="connection-nav-row-actions">
      <button type="button" aria-label={pinned ? "고정 해제" : "세션 고정"} title="이 브라우저에서 고정" aria-pressed={pinned} onClick={event => {
        event.stopPropagation(); update(value => toggleNavigationPin(value, session));
      }}><svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8"><path d="m16 3 5 5-4 2-3 5-3-2-7 7 6-8-2-3 5-3z" /></svg></button>
      <button type="button" aria-label={archived ? "보관 해제" : "세션 보관"} title="이 브라우저에서 보관" onClick={event => {
        event.stopPropagation(); update(value => toggleNavigationArchive(value, session));
      }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="4" width="16" height="16" rx="3" /><path d={archived ? "m8 13 4-4 4 4" : "M8 10h8"} /></svg></button>
    </span>;
  }
  function row(session: NavigationSession, pinnedSection = false) {
    const key = navigationKey(session);
    const provider = registry.get(session), connection = provider.connection;
    const activate = () => onSelectSession(registry.select(session));
    if (provider.capabilities.send && provider.capabilities.live) {
      const interactive = renderInteractive(session, actions(session), activate);
      if (interactive) return <div className="connection-nav-local-row" key={key}>{interactive}</div>;
    }
    const selected = selectedSession && navigationKey(selectedSession.ref) === key;
    return <div key={key} className={"connection-nav-row" + (selected ? " is-selected" : "")}>
      <button type="button" className="connection-nav-session" aria-current={selected ? "page" : undefined} title={`${connection.label} · ${session.backend}\n${session.cwd}\n${session.title}`}
        onClick={activate}>
        <span className="connection-nav-title">{session.title}</span>
        <small title={session.cwd}>{pinnedSection ? `${connection.label} · ${session.backend} · ` : ""}{session.cwd}</small>
      </button>{actions(session)}
    </div>;
  }
  return <nav className="connection-navigation" aria-label="연결별 세션">
    <div className="connection-nav-section-heading"><span>고정된 세션</span><small title="고정과 보관 설정은 이 브라우저에 저장됩니다.">브라우저</small></div>
    {navigation.pinned.map(session => row(session, true))}
    {!navigation.pinned.length && <p className="connection-nav-note">세션에 마우스를 올려 고정하세요.</p>}
    <div className="connection-nav-section-heading"><span>연결</span><button type="button" onClick={onManageConnections} aria-label="연결 등록 및 관리">＋</button></div>
    {(error || operationError) && <p role="alert" className="connection-nav-error">{operationError || error}</p>}
    {navigation.groups.map((group, index) => {
      const connection = connections.find(item => item.id === group.id);
      const state = connection?.state || "connected";
      const collapsed = prefs.collapsed.includes(group.id);
      const limit = limits[group.id] || 5;
      const local = group.id === "local";
      const sourceCount = groups.find(item => item.id === group.id)?.sessions.length || 0;
      const section = <>
        {group.sessions.slice(0, limit).map(session => row(session))}
        {!group.sessions.length && <p className="connection-nav-note">{sourceCount && query ? "검색 결과 없음" : sourceCount ? "표시할 세션 없음" : local ? "저장된 Pi 세션 없음" : state === "connected" ? "저장된 세션 없음" : "SSH 연결 후 세션을 불러옵니다."}</p>}
        {group.sessions.length > limit && <button className="connection-nav-more" type="button" onClick={() => setLimits(value => ({ ...value, [group.id]: limit + 5 }))}>더 보기</button>}
        {limit > 5 && <button className="connection-nav-more" type="button" onClick={() => setLimits(value => ({ ...value, [group.id]: 5 }))}>최근 5개만 보기</button>}
        {connection?.inventory?.truncated && <p className="connection-nav-note">최신 300개까지 조회됨</p>}
      </>;
      return <section key={group.id} className="connection-nav-group" aria-label={group.label}>
        <div className="connection-nav-host-row">
          <button type="button" className="connection-nav-host" aria-expanded={!collapsed} onClick={() => update(value => ({ ...value, collapsed: collapsed ? value.collapsed.filter(id => id !== group.id) : [...value.collapsed, group.id] }))}>
            <span className="connection-nav-chevron">{collapsed ? "▸" : "▾"}</span>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={local ? "currentColor" : group.alias === "cocoamini" ? "#63b599" : group.alias === "oracle" ? "#9393dd" : "#c6a14c"} strokeWidth="1.6" aria-hidden="true">{local ? <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M1 20h22" /></> : <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>}</svg>
            <span>{group.label}</span>
          </button>
          {!local && <span className={"connection-nav-status is-" + state} title={state === "connected" ? "SSH 연결됨" : state === "connecting" ? "SSH 연결 중" : state === "error" ? connection?.error : "SSH 연결 해제됨"} aria-label={state === "connected" ? "SSH 연결됨" : "SSH " + state} />}
          {!local && state !== "connected" && state !== "connecting" && <button type="button" className="connection-nav-connect" disabled={busy === group.id} onClick={() => void operate(group.id, "connect")}>{busy === group.id ? "…" : "연결"}</button>}
          {!local && <button type="button" className="connection-nav-menu-toggle" aria-label={`${group.label} 연결 메뉴`} aria-expanded={menu === group.id} onClick={() => setMenu(menu === group.id ? undefined : group.id)}>⋯</button>}
          {menu === group.id && <div className="connection-nav-menu" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setMenu(undefined); } }}>
            <button type="button" disabled={busy === group.id} onClick={() => void operate(group.id, state === "connected" || state === "connecting" ? "disconnect" : "connect")}>{state === "connected" || state === "connecting" ? "연결 해제" : "SSH 연결"}</button>
            <button type="button" disabled={state !== "connected" || busy === group.id} onClick={() => void operate(group.id, "refresh")}>세션 새로고침</button>
            <button type="button" disabled={index <= 1} onClick={() => move(group.id, -1)}>위로 이동</button>
            <button type="button" disabled={index >= navigation.groups.length - 1} onClick={() => move(group.id, 1)}>아래로 이동</button>
            <button type="button" onClick={() => { setMenu(undefined); onManageConnections(); }}>연결 관리</button>
          </div>}
        </div>
        {!collapsed && <div className="connection-nav-group-sessions">{local ? renderLocalGroup(section) : section}</div>}
      </section>;
    })}
    <label className="connection-nav-archive-toggle"><input type="checkbox" checked={prefs.showArchived} onChange={event => update(value => ({ ...value, showArchived: event.target.checked }))} />보관된 세션 표시</label>
  </nav>;
}
