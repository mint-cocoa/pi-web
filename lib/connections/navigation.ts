export interface NavigationSession {
  connectionId: string;
  backend: "pi" | "codex";
  id: string;
  title: string;
  cwd: string;
  updatedAt: string;
  pinned?: boolean;
  archived?: boolean;
  running?: boolean;
  unread?: boolean;
  selected?: boolean;
}
export interface NavigationGroup { id: string; alias: string; label: string; sessions: NavigationSession[] }
export interface NavigationPreferences {
  pins: string[];
  unpinned: string[];
  archived: Record<string, boolean>;
  order: string[];
  collapsed: string[];
  showArchived: boolean;
}
export const DEFAULT_NAVIGATION: NavigationPreferences = { pins: [], unpinned: [], archived: {}, order: [], collapsed: [], showArchived: false };
export const NAVIGATION_STORAGE_KEY = "pi-web:connection-navigation:v1";
export function navigationKey(session: Pick<NavigationSession, "connectionId" | "backend" | "id">): string {
  return JSON.stringify([session.connectionId, session.backend, session.id]);
}
export function readNavigationPreferences(raw: string | null): NavigationPreferences {
  try {
    const value = JSON.parse(raw || "null");
    if (!value || typeof value !== "object") return { ...DEFAULT_NAVIGATION };
    const strings = (items: unknown): string[] => Array.isArray(items) ? [...new Set(items.filter((x): x is string => typeof x === "string" && x.length < 600))].slice(0, 2000) : [];
    const archived: Record<string, boolean> = {};
    if (value.archived && typeof value.archived === "object") {
      for (const [key, item] of Object.entries(value.archived).slice(0, 2000)) if (typeof item === "boolean" && key.length < 600) archived[key] = item;
    }
    return { pins: strings(value.pins), unpinned: strings(value.unpinned), archived, order: strings(value.order), collapsed: strings(value.collapsed), showArchived: value.showArchived === true };
  } catch { return { ...DEFAULT_NAVIGATION }; }
}
export function isNavigationPinned(session: NavigationSession, prefs: NavigationPreferences) {
  const key = navigationKey(session);
  return prefs.pins.includes(key) || (session.pinned === true && !prefs.unpinned.includes(key));
}
export function isNavigationArchived(session: NavigationSession, prefs: NavigationPreferences) {
  const key = navigationKey(session);
  return Object.prototype.hasOwnProperty.call(prefs.archived, key) ? prefs.archived[key] : session.archived === true;
}
export function toggleNavigationPin(prefs: NavigationPreferences, session: NavigationSession): NavigationPreferences {
  const key = navigationKey(session), pinned = isNavigationPinned(session, prefs);
  return { ...prefs, pins: pinned ? prefs.pins.filter(item => item !== key) : [...prefs.pins.filter(item => item !== key), key],
    unpinned: pinned && session.pinned ? [...prefs.unpinned.filter(item => item !== key), key] : prefs.unpinned.filter(item => item !== key) };
}
export function toggleNavigationArchive(prefs: NavigationPreferences, session: NavigationSession): NavigationPreferences {
  const key = navigationKey(session), next = !isNavigationArchived(session, prefs), archived = { ...prefs.archived };
  if (next === (session.archived === true)) delete archived[key]; else archived[key] = next;
  return { ...prefs, archived };
}
export function sortNavigationGroups(groups: readonly NavigationGroup[], order: readonly string[]) {
  const rank = (group: NavigationGroup) => {
    if (group.id === "local") return -1;
    const index = order.indexOf(group.id);
    return index >= 0 ? index : order.length + (group.alias === "cocoamini" ? 0 : group.alias === "oracle" ? 1 : 2);
  };
  return [...groups].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}
export function sortNavigationSessions(sessions: readonly NavigationSession[]) {
  const timestamp = (value: string) => Date.parse(value) || 0;
  return [...sessions].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt) || navigationKey(a).localeCompare(navigationKey(b)));
}
export function buildNavigation(groups: readonly NavigationGroup[], prefs: NavigationPreferences, query = "") {
  const term = query.trim().toLocaleLowerCase();
  const visible = (session: NavigationSession) => (prefs.showArchived || !isNavigationArchived(session, prefs)) && (!term || (session.title + " " + session.cwd).toLocaleLowerCase().includes(term));
  const sorted = sortNavigationGroups(groups, prefs.order);
  const pinned = sorted.flatMap(group => sortNavigationSessions(group.sessions).filter(session => visible(session) && isNavigationPinned(session, prefs)));
  pinned.sort((a, b) => {
    const ia = prefs.pins.indexOf(navigationKey(a)), ib = prefs.pins.indexOf(navigationKey(b));
    return (ia < 0 ? prefs.pins.length : ia) - (ib < 0 ? prefs.pins.length : ib);
  });
  return { pinned, groups: sorted.map(group => ({ ...group, sessions: sortNavigationSessions(group.sessions).filter(session => visible(session) && !isNavigationPinned(session, prefs)) })) };
}
