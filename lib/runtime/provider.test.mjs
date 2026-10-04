import assert from 'node:assert/strict';
import test from 'node:test';
import { createExecutionProvider } from './provider.ts';

test('execution providers bind all operations to the selected host and engine',async()=>{
  const calls=[]; const operation=(name)=>async(ref,...args)=>{calls.push({name,ref,args});return {ref,cursor:1};};
  const operations=Object.fromEntries(['list','models','create','open','send','interrupt','reply','watch'].map(name=>[name,operation(name)]));
  for(const target of [{connectionId:'local',backend:'pi'},{connectionId:'ssh',backend:'codex'}]) {
    const provider=createExecutionProvider(target,operations),ref={...target,id:'same'};
    await provider.create({cwd:'~',requestId:'once'});await provider.open(ref);await provider.send(ref,'hello');await provider.interrupt(ref);await provider.reply(ref,2,{decision:'decline'});
    assert.ok(calls.slice(-5).every(call=>call.ref.connectionId===target.connectionId && call.ref.backend===target.backend));
    assert.throws(()=>provider.send({...ref,connectionId:'other'},'bad'),/does not belong/);
    assert.ok(Object.isFrozen(provider.target));
  }
});
test('mutating the caller reference cannot retarget an in-flight runtime operation',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);let delivered;
  const provider=createExecutionProvider({connectionId:'ssh',backend:'codex'},{open:async ref=>{await gate;delivered=ref;return {ref};}});
  const ref={connectionId:'ssh',backend:'codex',id:'first'};const pending=provider.open(ref);ref.id='other';release();await pending;
  assert.equal(delivered.id,'first');assert.ok(Object.isFrozen(delivered));
});
