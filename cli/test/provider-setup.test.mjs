import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProviderSelection} from '../dist/config.js';

test('provider selection supports all and multiple choices',()=>{
  assert.deepEqual(parseProviderSelection('a'),[0,1,2,3]);
  assert.deepEqual(parseProviderSelection('1,3,4'),[0,2,3]);
  assert.deepEqual(parseProviderSelection('4 2 2'),[1,3]);
  assert.deepEqual(parseProviderSelection('0'),[]);
  assert.deepEqual(parseProviderSelection(''),[]);
});
test('provider selection rejects bad indices',()=>{
  for(const invalid of ['5','-1','1,5','texto','1,foo'])
    assert.throws(()=>parseProviderSelection(invalid));
});
