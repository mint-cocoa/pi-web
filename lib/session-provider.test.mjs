import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSessionProvider,SessionProviderRegistry,UnsupportedSessionOperation} from './session-provider.ts';
const summary=(connectionId,backend='pi',id='same')=>({connectionId,backend,id,title:'Title',cwd:'/workspace',updatedAt:'2026-10-04T00:00:00Z'});
 const provider=(connectionId,backend='pi',operations={})=>createSessionProvider({connection:{id:connectionId,alias:connectionId,label:connectionId},backend,catalog:()=>[summary(connectionId,backend)],operations:{read:async()=>({messages:[{role:'user',text:connectionId}],truncated:false}),...operations}});
test('the same reference/list/read contract works on local Pi and SSH Pi/Codex',async()=>{
 const registry=new SessionProviderRegistry([provider('local'),provider('ssh'),provider('ssh','codex')]);
 assert.equal((await registry.list()).length,3);
 for(const ref of [summary('local'),summary('ssh'),summary('ssh','codex')]) {
  assert.deepEqual(registry.select(ref).ref,{connectionId:ref.connectionId,backend:ref.backend,id:ref.id});
  assert.equal((await registry.read(ref)).messages[0].text,ref.connectionId);
 }
});
test('unsupported writes are denied before transport runs and capabilities cannot be mutated',async()=>{
 let calls=0;const readOnly=provider('ssh','codex',{read:async()=>{calls++;return {messages:[],truncated:false};}});
 assert.equal(readOnly.capabilities.send,false);assert.ok(Object.isFrozen(readOnly.capabilities));
 await assert.rejects(readOnly.send(summary('ssh','codex'),'hello'),UnsupportedSessionOperation);
 await assert.rejects(readOnly.rename(summary('ssh','codex'),'name'),UnsupportedSessionOperation);
 await assert.rejects(readOnly.remove(summary('ssh','codex')),UnsupportedSessionOperation);
 assert.equal(calls,0);
});
test('cross-provider references, unknown records and transient disk actions never reach a writer',async()=>{
 let writes=0;const native=provider('local','pi',{rename:async()=>writes++});
 await assert.rejects(native.rename(summary('ssh'),'bad'),/일치/);
 await assert.rejects(native.rename(summary('local','pi','unknown'),'bad'),/목록/);
 const transient=createSessionProvider({connection:{id:'local',alias:'local',label:'Local'},backend:'pi',catalog:()=>[{...summary('local'),transient:true}],operations:{read:async()=>({messages:[],truncated:false}),remove:async()=>writes++}});
 await assert.rejects(transient.remove(summary('local')),/저장/);assert.equal(writes,0);
});
test('a failing provider does not discard healthy lists, and duplicate providers are refused',async()=>{
 const broken=provider('broken','pi',{list:async()=>{throw Error('offline');}});
 const lists=await new SessionProviderRegistry([broken,provider('local')]).list();
 assert.equal(lists[0].sessions.length,0);assert.ok(lists[0].error);assert.equal(lists[1].sessions.length,1);
 assert.throws(()=>new SessionProviderRegistry([provider('local'),provider('local')]),/중복/);
});
test('a pending read cannot be retargeted by mutating its caller reference',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 const source=provider('ssh','codex',{read:async ref=>{await gate;return {messages:[{role:'user',text:ref.id}],truncated:false};}});
 const ref=summary('ssh','codex');const pending=source.read(ref);ref.id='other';release();
 assert.equal((await pending).messages[0].text,'same');
});
