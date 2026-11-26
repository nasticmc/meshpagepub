import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { createSharedPageDocument, sharedPageSnapshot } from './collaboration-document.js';

test('creates a shared document with stable message identities', () => {
  const doc=createSharedPageDocument({title:'Field update',messages:['one','two']});
  const page=sharedPageSnapshot(doc);
  assert.equal(page.title,'Field update');
  assert.deepEqual(page.messages.map(message=>message.text),['one','two']);
  assert.equal(new Set(page.messages.map(message=>message.id)).size,2);
});

test('converges a title and message-text edit through a Yjs update', () => {
  const source=createSharedPageDocument({title:'Draft',messages:['first']});
  const target=new Y.Doc();
  Y.applyUpdate(target,Y.encodeStateAsUpdate(source));

  const messageId=sharedPageSnapshot(source).messages[0].id;
  source.transact(()=>{
    source.getMap('page').get('title').insert(5,' update');
    const message=source.getMap('page').get('messages').get(0);
    message.get('text').insert(5,' message');
  });
  Y.applyUpdate(target,Y.encodeStateAsUpdate(source,Y.encodeStateVector(target)));

  assert.deepEqual(sharedPageSnapshot(target),{
    title:'Draft update',messages:[{id:messageId,text:'first message'}]
  });
});
