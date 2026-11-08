import test from 'node:test';
import assert from 'node:assert/strict';
import { splitMessages, sendInOrder, normalizeRoomTarget, validateMessage, reorderMessages, secondsToMilliseconds } from './publisher.js';

test('split messages retains newline characters verbatim', () => {
  assert.deepEqual(splitMessages(['first\nsecond', ' third ', '']), ['first\nsecond', ' third ']);
});
test('room-server public key validates and converts to 32 bytes', () => {
  const key='0123456789abcdef'.repeat(4);
  assert.deepEqual([...normalizeRoomTarget({kind:'room-server',publicKey:key})], [...Buffer.from(key,'hex')]);
  assert.throws(() => normalizeRoomTarget({kind:'room-server',publicKey:'room-a'}), /64 hexadecimal/);
});
test('filters radio contacts to advertised room-server nodes', async () => {
  const { MeshCorePublisher } = await import('./publisher.js');
  const key=Uint8Array.from({length:32},(_,i)=>i);
  const publisher=new MeshCorePublisher({getContacts:async()=>[
    {type:3,publicKey:key,advName:'Room A',outPathLen:1,lastAdvert:123},
    {type:1,publicKey:key,advName:'Chat peer'}
  ]});
  const servers=await publisher.roomServers();
  assert.equal(servers.length,1);
  assert.equal(servers[0].name,'Room A');
  assert.equal(servers[0].publicKeyHex,'000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
});

test('enforces the 151-byte room-server limit in UTF-8 bytes', () => {
  assert.equal(validateMessage('a'.repeat(151)).bytes,151);
  assert.equal(validateMessage('a'.repeat(152)).valid,false);
  assert.equal(validateMessage('é'.repeat(76)).bytes,152);
  assert.equal(validateMessage('line 1\nline 2').valid,true);
});
test('reorders messages without losing text', () => {
  assert.deepEqual(reorderMessages(['first','second','third'],0,2),['second','third','first']);
  assert.deepEqual(reorderMessages(['first','second'],1,1),['first','second']);
});
test('publishes each item sequentially and waits between sends', async () => {
  const events=[];
  await sendInOrder(['a','b','c'], async m=>events.push(`send:${m}`), async ms=>events.push(`wait:${ms}`), 700);
  assert.deepEqual(events,['send:a','wait:700','send:b','wait:700','send:c']);
});
test('stop signal prevents subsequent sends', async () => {
  const sent=[];
  await assert.rejects(sendInOrder(['a','b'], async m=>{sent.push(m)}, async()=>{}, 400, ()=>sent.length===1), /stopped/);
  assert.deepEqual(sent,['a']);
});

test('converts whole-second delay values to milliseconds', () => {
  assert.equal(secondsToMilliseconds(1), 1000);
  assert.equal(secondsToMilliseconds('3'), 3000);
  assert.throws(() => secondsToMilliseconds(0), /whole number of seconds/);
  assert.throws(() => secondsToMilliseconds(1.5), /whole number of seconds/);
});
