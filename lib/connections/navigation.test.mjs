import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNavigation, navigationKey, readNavigationPreferences, sortNavigationSessions, toggleNavigationArchive, toggleNavigationPin, isNavigationPinned, isNavigationArchived, DEFAULT_NAVIGATION } from './navigation.ts';
const session = (connectionId,id,updatedAt='2026-10-04T00:00:00Z',backend='pi') => ({connectionId,id,backend,title:id,cwd:'/project',updatedAt});
test('identity separates equal session ids on different hosts and backends', () => {
  assert.equal(new Set([session('local','same'),session('a','same'),session('a','same',undefined,'codex')].map(navigationKey)).size,3);
});
test('stable server order is independent of activity and handles timestamps with offsets', () => {
  const groups=[{id:'o',alias:'oracle',label:'oracle',sessions:[session('o','older')]},{id:'c',alias:'cocoamini',label:'cocoamini',sessions:[]},{id:'local',alias:'local',label:'로컬',sessions:[]}];
  assert.deepEqual(buildNavigation(groups,DEFAULT_NAVIGATION).groups.map(x=>x.id),['local','c','o']);
  assert.deepEqual(buildNavigation(groups,{...DEFAULT_NAVIGATION,order:['o','c']}).groups.map(x=>x.id),['local','o','c']);
  const out=sortNavigationSessions([session('c','utc','2026-10-04T01:00:00Z'),session('c','offset','2026-10-04T09:30:00+09:00')]);
  assert.equal(out[0].id,'utc');
});
test('pins are ordered explicitly, archives do not leak into recent items, and folder search stays per server', () => {
  const first=session('c','a'), second=session('c','b'), archived={...session('c','hidden'),archived:true};
  const group={id:'c',alias:'cocoamini',label:'cocoamini',sessions:[first,second,archived]};
  const prefs={...DEFAULT_NAVIGATION,pins:[navigationKey(second),navigationKey(first)]};
  const out=buildNavigation([group],prefs);
  assert.deepEqual(out.pinned.map(x=>x.id),['b','a']); assert.equal(out.groups[0].sessions.length,0);
  const restored=buildNavigation([group],{...prefs,archived:{[navigationKey(archived)]:false}});
  assert.equal(restored.groups[0].sessions[0].id,'hidden');
  assert.equal(buildNavigation([group],DEFAULT_NAVIGATION,'/project').groups[0].sessions.length,2);
});
test('broken browser preferences safely fall back, with bounded and de-duplicated values', () => {
  assert.deepEqual(readNavigationPreferences('{'),DEFAULT_NAVIGATION);
  assert.deepEqual(readNavigationPreferences(JSON.stringify({pins:['a','a',42],order:['c','c'],showArchived:'yes'})).pins,['a']);
  assert.equal(readNavigationPreferences(JSON.stringify({showArchived:'yes'})).showArchived,false);
});
test('undo restores native defaults without leaving an override on ordinary sessions', () => {
  const item=session('c','normal');
  let prefs=toggleNavigationPin(DEFAULT_NAVIGATION,item);assert.equal(isNavigationPinned(item,prefs),true);
  prefs=toggleNavigationPin(prefs,item);assert.deepEqual(prefs,DEFAULT_NAVIGATION);
  prefs=toggleNavigationArchive(prefs,item);assert.equal(isNavigationArchived(item,prefs),true);
  prefs=toggleNavigationArchive(prefs,item);assert.deepEqual(prefs,DEFAULT_NAVIGATION);
  const native={...item,archived:true,pinned:true};
  prefs=toggleNavigationArchive(DEFAULT_NAVIGATION,native);assert.equal(isNavigationArchived(native,prefs),false);
  prefs=toggleNavigationArchive(prefs,native);assert.deepEqual(prefs,DEFAULT_NAVIGATION);
  assert.equal(isNavigationPinned(native,toggleNavigationPin(DEFAULT_NAVIGATION,native)),false);
});
