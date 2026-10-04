import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url);
const {createLocalPiProvider,createSshSessionProvider}=await jiti.import('./session-provider-adapters.ts');
const summary={connectionId:'local',backend:'pi',id:'s1',title:'Session',cwd:'/workspace',updatedAt:'2026-10-04T00:00:00Z'};
test('local Pi uses its existing read and command APIs under the provider contract',async()=>{
 const calls=[];
 const request=async(url,body,signal,method)=>{
  calls.push({url,body,method});
  if(url.includes('tail='))return {context:{messages:[{role:'user',content:'hello'},{role:'assistant',content:[{type:'text',text:'reply'}]}],hasMore:true}};
  return {data:{disposition:'started'}};
 };
 const provider=createLocalPiProvider(()=>[summary],request);
 assert.equal(provider.capabilities.send,true);assert.equal(provider.capabilities.live,true);
 assert.deepEqual((await provider.read(summary)).messages,[{role:'user',text:'hello'},{role:'assistant',text:'reply'}]);
 assert.equal((await provider.send(summary,'manual prompt')).disposition,'started');
 await provider.rename(summary,'Updated');await provider.remove(summary);
 assert.equal(calls[0].url,'/api/sessions/s1?tail=100');
 assert.deepEqual(calls[1],{url:'/api/agent/s1',body:{type:'prompt',message:'manual prompt'},method:undefined});
 assert.equal(calls[2].method,'PATCH');assert.equal(calls[3].method,'DELETE');
});
test('SSH adapter has the same read result and rejects changed hosts before requesting history',async()=>{
 const item={...summary,connectionId:'ssh',backend:'codex',id:'a'.repeat(64)};
 let alias='cocoamini';const calls=[];
 const request=async body=>{calls.push(body);return body?{messages:[{role:'assistant',text:'remote reply'}],truncated:false}:{connections:[{id:'ssh',alias,state:'connected',inventory:{sessions:[item]}}]};};
 const descriptor={id:'ssh',label:'Server',alias:'cocoamini'};
 const provider=createSshSessionProvider(descriptor,'codex',()=>[item],request);
 assert.equal(provider.capabilities.send,false);assert.equal((await provider.read(item)).messages[0].text,'remote reply');
 alias='other-host';descriptor.alias=alias;calls.length=0;await assert.rejects(provider.read(item),/변경/);assert.equal(calls.length,1);
});
