import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { SshConnection } = await jiti.import('./transport.ts');
const { REMOTE_BRIDGE } = await jiti.import('./bridge.ts');

function fakeProcess() {
  const process = new EventEmitter();
  Object.assign(process, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, killed: 0 });
  process.kill = () => { process.killed++; process.exitCode = 0; process.emit('close', 0); };
  return process;
}
test('SSH replies correlate out of order, and disconnect rejects pending requests exactly once', async () => {
  const process = fakeProcess();
  let closed = 0;
  const connection = new SshConnection('oracle', () => closed++, () => process);
  const a = connection.request('inventory');
  const b = connection.request('ping');
  const bytes = Buffer.from('{"id":2,"result":{"alive":true}}\n{"id":1,"result":{"name":"한글"}}\n');
  const split = bytes.indexOf(Buffer.from('한')) + 1;
  process.stdout.write(bytes.subarray(0, split)); process.stdout.write(bytes.subarray(split));
  assert.deepEqual(await a, { name: '한글' }); assert.deepEqual(await b, { alive: true });
  const pending = assert.rejects(connection.request('ping'), /disconnected/);
  connection.close(); connection.close(); await pending;
  assert.equal(closed, 1); assert.equal(process.killed, 1);
  await assert.rejects(connection.request('ping'), /Connect/);
});
test('invalid remote protocol closes only the owned process and fails its requests', async () => {
  const process = fakeProcess();
  let error;
  const connection = new SshConnection('oracle', value => error = value, () => process);
  const pending = assert.rejects(connection.request('inventory'), /Invalid or oversized/);
  process.stdout.write('not-json\n'); await pending;
  assert.match(error, /Invalid or oversized/); assert.equal(process.killed, 1);
});
test('read-only helper indexes fixed roots, refuses arbitrary paths and symlinks, and reads Pi/Codex records', { skip: process.platform === 'win32' }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'pi-remote-test-'));
  const piRoot = join(home, '.pi/agent/sessions/project');
  const codexRoot = join(home, '.codex/sessions/2026/10/04');
  await mkdir(piRoot, { recursive: true }); await mkdir(codexRoot, { recursive: true });
  const pi = [ { type: 'session', id: 'pi-id', cwd: '/project' }, { type: 'message', message: { role: 'user', content: '안녕\u2028world' } }, { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } } ];
  const codex = [ { type: 'session_meta', payload: { id: 'codex-id', cwd: '/codex-project' } }, { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions' }], internal_chat_message_metadata_passthrough: { content_item_kinds: ['agents_md.instructions'] } } }, { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'question' }], internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] } } }, { type: 'event_msg', payload: { type: 'user_message', message: 'question' } }, { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] } } ];
  execFileSync('python3', ['-c', "import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute('CREATE TABLE threads(id TEXT,title TEXT,archived INTEGER,is_pinned INTEGER,name TEXT)'); db.execute(\"INSERT INTO threads VALUES('codex-id','Original long question',1,1,'Renamed conversation')\"); db.commit(); db.close()", join(home, '.codex/state_5.sqlite')]);
  await writeFile(join(piRoot, 'pi.jsonl'), pi.map(JSON.stringify).join('\n') + '\n');
  await writeFile(join(codexRoot, 'codex.jsonl'), codex.map(JSON.stringify).join('\n') + '\n');
  const outside = join(home, 'outside.jsonl'); await writeFile(outside, JSON.stringify(pi[0]));
  await symlink(outside, join(piRoot, 'link.jsonl'));
  const child = spawn('python3', ['-u', '-c', REMOTE_BRIDGE], { env: { ...process.env, HOME: home } });
  let buffer = ''; const pending = new Map();
  child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const reply = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      pending.get(reply.id)?.(reply); pending.delete(reply.id);
    }
  });
  let id = 0;
  const request = (method, params = {}) => new Promise(resolve => {
    const next = ++id; pending.set(next, resolve); child.stdin.write(JSON.stringify({ id: next, method, ...params }) + '\n');
  });
  try {
    const { result } = await request('inventory'); assert.equal(result.sessions.length, 2);
    const piSession = result.sessions.find(x => x.backend === 'pi');
    const codexSession = result.sessions.find(x => x.backend === 'codex');
    assert.equal(codexSession.title, 'Renamed conversation');
    assert.equal(codexSession.archived, true); assert.equal(codexSession.pinned, true);
    assert.equal(piSession.title, '안녕\u2028world');
    assert.equal((await request('transcript', { sessionId: piSession.id })).result.messages[1].text, 'reply');
    assert.deepEqual((await request('transcript', { sessionId: codexSession.id })).result.messages, [{ role: 'user', text: 'question' }, { role: 'assistant', text: 'answer' }]);
    assert.ok((await request('transcript', { sessionId: outside })).error);
    assert.ok((await request('shell', { command: 'id' })).error);
  } finally {
    const exited = once(child, 'close'); child.stdin.end(); await exited;
    await rm(home, { recursive: true, force: true });
  }
});
