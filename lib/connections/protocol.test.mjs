import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JsonLines, sshArguments, configuredAliases } from './protocol.ts';

test('SSH aliases cannot inject options or a shell command and enforce existing host keys', () => {
  for (const bad of ['-oProxyCommand=evil', 'oracle;id', 'a b', '../foo', 'a\nHost evil', 'a$(id)']) {
    assert.throws(() => sshArguments(bad, 'pass'));
  }
  const args = sshArguments('oracle', "print('ok')");
  assert.ok(args.includes('BatchMode=yes'));
  assert.ok(args.includes('StrictHostKeyChecking=yes'));
  assert.ok(args.includes('ControlPath=none'));
  assert.equal(args.at(-2), 'oracle');
  if (process.platform !== 'win32') assert.equal(execFileSync('sh', ['-c', args.at(-1)], { encoding: 'utf8' }), 'ok\n');
  assert.deepEqual(configuredAliases('Host oracle cocoamini # trusted\nHost * !evil\n  IdentityFile secret\nHost -oops'), ['cocoamini', 'oracle']);
});

test('JSONL preserves split frames, CRLF, Unicode separators, and refuses oversized messages', () => {
  const out = [];
  const decoder = new JsonLines(x => out.push(x));
  const value = JSON.stringify({ id: 1, text: 'x\u2028y\u2029z' });
  decoder.push(value.slice(0, 12));
  decoder.push(value.slice(12) + '\r\n{"id":2}\n');
  assert.deepEqual(out, [{ id: 1, text: 'x\u2028y\u2029z' }, { id: 2 }]);
  assert.throws(() => new JsonLines(() => {}, 5).push('123456'));
  assert.throws(() => new JsonLines(() => {}, 5).push('123456\n'));
});
