import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalRecord, codexDelta, codexMessages, piRequest } from './normalize.ts';

test('native Codex turns become the same message/tool result types as Pi', () => {
  const messages = codexMessages({turns:[{items:[
    {type:'userMessage',content:[{type:'text',text:'hello'}]},
    {type:'agentMessage',id:'a',text:'working'},
    {type:'commandExecution',id:'tool',command:'pwd',cwd:'/workspace',aggregatedOutput:'/workspace',status:'completed'},
    {type:'agentMessage',id:'b',text:'done'},
  ]}]}, 'gpt-6-luna');
  assert.deepEqual(messages.map(message=>message.role), ['user','assistant','assistant','toolResult','assistant']);
  assert.equal(messages[2].content[0].toolCallId, messages[3].toolCallId);
  assert.equal(messages[2].content[0].input.cwd, '/workspace');
});
test('a new streamed item does not append to a previous assistant message', () => {
  const saved=codexMessages({turns:[{items:[{type:'agentMessage',text:'old'}]}]});
  let messages=codexDelta(saved,'new','model',false);
  messages=codexDelta(messages,' text','model',true);
  assert.equal(messages.length,2);
  assert.equal(messages[0].content[0].text,'old');
  assert.equal(messages[1].content[0].text,'new text');
});
test('only supported server approval requests are exposed as actionable approvals', () => {
  assert.equal(approvalRecord({id:2,method:'unknown/requestApproval'}),null);
  assert.equal(approvalRecord({method:'item/commandExecution/requestApproval'}),null);
  const request=approvalRecord({id:2,method:'item/commandExecution/requestApproval',params:{command:'echo test',reason:'test'}});
  assert.equal(request.kind,'approval'); assert.match(request.detail,/echo test/);
  const question=approvalRecord({id:3,method:'item/tool/requestUserInput',params:{questions:[{id:'q',question:'Choose'}]}});
  assert.equal(question.kind,'question'); assert.equal(question.questions[0].id,'q');
});
test('Pi confirmation, selection and input keep their own reply semantics', () => {
  assert.equal(piRequest({type:'extension_ui_request',id:'a',method:'notify'}),null);
  assert.equal(piRequest({type:'extension_ui_request',id:'a',method:'confirm',title:'Approve',message:'change'}).kind,'approval');
  const selection=piRequest({type:'extension_ui_request',id:'b',method:'select',title:'Choose',options:['one','two']});
  assert.equal(selection.kind,'question'); assert.deepEqual(selection.questions[0].options,[{label:'one'},{label:'two'}]);
});
