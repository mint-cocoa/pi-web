import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionController } from './controller.ts';

test('local Pi and SSH Codex use identical controller operations with explicit references',async()=>{
  const original=globalThis.fetch; const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json({ref:calls.at(-1).ref,cursor:1});};
  try {
    for(const ref of [{connectionId:'local',backend:'pi',id:'same'},{connectionId:'ssh',backend:'codex',id:'same'}]) {
      const controller=new SessionController(ref);
      await controller.open(); await controller.send('hello'); await controller.interrupt(); await controller.reply(4,{answers:{q:'choice'}});
      assert.deepEqual(calls.slice(-4).map(call=>call.action),['open','send','interrupt','reply']);
      assert.ok(calls.slice(-4).every(call=>JSON.stringify(call.ref)===JSON.stringify(ref)));
    }
    await SessionController.create({connectionId:'ssh',backend:'codex'},'~','gpt-6-luna','receipt');
    assert.equal(calls.at(-1).options.requestId,'receipt');
  } finally { globalThis.fetch=original; }
});
test('detaching a UI closes only its SSE subscription, without interrupting a job',()=>{
  const original=globalThis.EventSource; const streams=[];
  globalThis.EventSource=class {constructor(url){this.url=url; streams.push(this);} close(){this.closed=true;}};
  try {
    const controller=new SessionController({connectionId:'ssh',backend:'codex',id:'thread'});
    let received; const detach=controller.subscribe(snapshot=>received=snapshot);
    streams[0].onmessage({data:JSON.stringify({cursor:7})}); assert.equal(received.cursor,7);
    detach(); assert.equal(streams[0].closed,true); assert.match(streams[0].url,/sessionId=thread/);
  } finally {globalThis.EventSource=original;}
});
