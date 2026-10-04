import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SessionViewRegistry,sessionViewModel} from './session-view.ts';
const ref=(connectionId,backend='pi')=>({connectionId,backend,id:'same'});
test('display registration is independent of transport and supports exact, backend and fallback adapters',()=>{
 const registry=new SessionViewRegistry([{id:'fallback',mode:'overlay'},{id:'pi',target:{backend:'pi'},mode:'overlay'},{id:'native',target:{connectionId:'local',backend:'pi'},mode:'native'}]);
 assert.equal(registry.resolve(ref('local')).id,'native');
 assert.equal(registry.resolve(ref('ssh')).id,'pi');
 assert.equal(registry.resolve(ref('ssh','codex')).id,'fallback');
});
test('an adapter cannot steal another provider by sharing a session id and its target is immutable',()=>{
 const target={connectionId:'local',backend:'pi'};
 const registry=new SessionViewRegistry([{id:'native',target,mode:'native'},{id:'other',mode:'overlay'}]);
 target.connectionId='ssh';assert.equal(registry.resolve(ref('ssh')).id,'other');
 assert.ok(Object.isFrozen(registry.resolve(ref('local')).target));
 assert.throws(()=>new SessionViewRegistry([{id:'one'},{id:'two'}]),/중복/);
});
test('view controls follow actual capabilities instead of local or remote labels',()=>{
 const model=sessionViewModel({ref:ref('ssh','codex'),summary:{title:'Title',cwd:'/remote'},provider:{connection:{label:'Server'},capabilities:{read:true,send:false,rename:false,remove:false,live:false}}});
 assert.equal(model.subtitle,'Server · codex');assert.equal(model.canSend,false);assert.equal(model.canRename,false);assert.ok(Object.isFrozen(model));
 const interactive=sessionViewModel({ref:ref('ssh'),summary:{title:'Pi',cwd:'/remote'},provider:{connection:{label:'Server'},capabilities:{read:true,send:true,rename:true,remove:true,live:true}}});
 assert.equal(interactive.canSend,true);assert.equal(interactive.isLive,true);
});
test('overriding only one slot preserves the shared conversation and mount policy',()=>{
 const base=()=> 'transcript', row=()=> 'custom-row';
 const registry=new SessionViewRegistry([{id:'base',mode:'overlay',conversation:base},{id:'row',target:{backend:'codex'},row}]);
 const adapter=registry.resolve(ref('ssh','codex'));
 assert.equal(adapter.row,row);assert.equal(adapter.conversation,base);assert.equal(adapter.mode,'overlay');
});
