import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeRuntimeSnapshot } from './snapshot.ts';
test('an older response cannot overwrite a newer live snapshot in the same server lifetime',()=>{
  const current={epoch:'a',cursor:200,messages:['current']},late={epoch:'a',cursor:12,messages:['old']};
  assert.equal(mergeRuntimeSnapshot(current,late),current);
  assert.equal(mergeRuntimeSnapshot(undefined,current),current);
});
test('reconnecting after server restart accepts its new epoch even when its cursor is smaller',()=>{
  const before={epoch:'a',cursor:200,messages:['old']},after={epoch:'b',cursor:1,messages:['recovered']};
  assert.equal(mergeRuntimeSnapshot(before,after),after);
});
