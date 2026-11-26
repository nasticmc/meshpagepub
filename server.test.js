import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { sharedPageSnapshot } from './collaboration-document.js';
import { createMeshPageServer } from './server.js';

async function withServer(run) {
  const dataDir=await mkdtemp(path.join(tmpdir(),'meshpage-server-'));
  const app=createMeshPageServer({root:process.cwd(),dataDir,codeSecret:'test-secret-for-http-shared-page-codes'});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const {port}=app.address();
  try { await run(`http://127.0.0.1:${port}`); } finally { await new Promise(resolve=>app.close(resolve)); await rm(dataDir,{recursive:true,force:true}); }
}

function once(socket,event){return new Promise((resolve,reject)=>{socket.once(event,resolve);socket.once('error',reject)})}
async function connect(url){
  const socket=new WebSocket(url),messages=[];
  socket.on('message',(data,isBinary)=>messages.push({data,isBinary}));
  socket.__meshpageMessages=messages;
  await once(socket,'open');
  return socket;
}
async function binaryMessage(socket){
  const queued=socket.__meshpageMessages.shift();
  const message=queued||await new Promise((resolve,reject)=>{socket.once('message',(data,isBinary)=>resolve({data,isBinary}));socket.once('error',reject)});
  assert.equal(message.isBinary,true);
  return new Uint8Array(message.data)
}

async function textMessage(socket){
  const queued=socket.__meshpageMessages.findIndex(message=>!message.isBinary);
  const message=queued>=0?socket.__meshpageMessages.splice(queued,1)[0]:await new Promise((resolve,reject)=>{socket.once('message',(data,isBinary)=>resolve({data,isBinary}));socket.once('error',reject)});
  assert.equal(message.isBinary,false);
  return JSON.parse(String(message.data));
}

test('automatically creates and reuses a durable collaboration secret', async () => {
  const dataDir=await mkdtemp(path.join(tmpdir(),'meshpage-auto-secret-'));
  try {
    const first=createMeshPageServer({root:process.cwd(),dataDir});
    await new Promise(resolve=>first.listen(0,'127.0.0.1',resolve));
    const {port}=first.address();
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/health`)).json(),{ok:true,collaboration:true});
    await new Promise(resolve=>first.close(resolve));
    const secret=await readFile(path.join(dataDir,'collaboration-secret'),'utf8');
    assert.ok(secret.trim().length>=32);
    assert.equal((await stat(path.join(dataDir,'collaboration-secret'))).mode&0o077,0);

    const second=createMeshPageServer({root:process.cwd(),dataDir});
    await new Promise(resolve=>second.listen(0,'127.0.0.1',resolve));
    const response=await fetch(`http://127.0.0.1:${second.address().port}/api/shared-pages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Draft',messages:['one']})});
    assert.equal(response.status,201);
    await new Promise(resolve=>second.close(resolve));
    assert.equal((await readFile(path.join(dataDir,'collaboration-secret'),'utf8')),secret);
  } finally { await rm(dataDir,{recursive:true,force:true}); }
});

test('relays temporary collaborator presence without storing it in page content', async () => {
  await withServer(async base => {
    const created=await fetch(`${base}/api/shared-pages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Draft',messages:['first']})});
    const {code}=await created.json(),wsBase=base.replace(/^http/,'ws');
    const first=await connect(`${wsBase}/collab/${code}`),second=await connect(`${wsBase}/collab/${code}`);
    try {
      await binaryMessage(first);await binaryMessage(second);
      first.send(JSON.stringify({type:'presence',name:'Alex',activeMessageId:'message-a'}));
      const presence=await textMessage(second);
      assert.deepEqual(presence,{type:'presence',collaborators:[{name:'Alex',activeMessageId:'message-a'}]});
    } finally { first.terminate();second.terminate(); }
  });
});

test('synchronizes a Yjs update between two shared-page WebSocket clients', async () => {
  await withServer(async base => {
    const created=await fetch(`${base}/api/shared-pages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Draft',messages:['first']})});
    const {code}=await created.json();
    const wsBase=base.replace(/^http/,'ws');
    const first=await connect(`${wsBase}/collab/${code}`),second=await connect(`${wsBase}/collab/${code}`);
    try {
      const firstDoc=new Y.Doc(),secondDoc=new Y.Doc();
      Y.applyUpdate(firstDoc,await binaryMessage(first));
      Y.applyUpdate(secondDoc,await binaryMessage(second));
      const outgoing=Y.encodeStateAsUpdate(firstDoc);
      firstDoc.getMap('page').get('title').insert(5,' update');
      const update=Y.encodeStateAsUpdate(firstDoc,Y.encodeStateVector(secondDoc));
      const incoming=binaryMessage(second);
      first.send(update);
      Y.applyUpdate(secondDoc,await incoming);
      assert.equal(sharedPageSnapshot(secondDoc).title,'Draft update');
      assert.equal(sharedPageSnapshot(secondDoc).messages[0].text,'first');
      assert.ok(outgoing.byteLength>0);
    } finally { first.terminate(); second.terminate(); }
  });
});

test('serves the shared-page shell without intercepting its JavaScript bundle', async () => {
  await withServer(async base => {
    const created=await fetch(`${base}/api/shared-pages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Draft',messages:['one']})});
    const {code}=await created.json();
    const share=await fetch(`${base}/share/${code}`);
    assert.equal(share.status,200);
    assert.match(await share.text(),/src="\/collab\.bundle\.js"/);
    const bundle=await fetch(`${base}/collab.bundle.js`);
    assert.equal(bundle.status,200);
    assert.match(bundle.headers.get('content-type'),/text\/javascript/);
  });
});

test('creates and retrieves shared-page metadata through the HTTP API', async () => {
  await withServer(async base => {
    const created=await fetch(`${base}/api/shared-pages`,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({title:'Team page',messages:['first','second']})
    });
    assert.equal(created.status,201);
    const page=await created.json();
    assert.match(page.code,/^m_[A-Za-z0-9_-]{22}$/);
    assert.equal(page.shareUrl,`/share/${page.code}`);

    const loaded=await fetch(`${base}/api/shared-pages/${page.code}`);
    assert.equal(loaded.status,200);
    assert.deepEqual(await loaded.json(),{title:'Team page',expiresAt:page.expiresAt,expired:false});
  });
});

test('does not expose shared-page content through the metadata endpoint', async () => {
  await withServer(async base => {
    const created=await fetch(`${base}/api/shared-pages`,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({title:'Team page',messages:['not metadata']})
    });
    const {code}=await created.json();
    const body=await (await fetch(`${base}/api/shared-pages/${code}`)).json();
    assert.equal(Object.hasOwn(body,'messages'),false);
    assert.equal(Object.hasOwn(body,'code'),false);
  });
});

test('rejects malformed shared-page creation requests', async () => {
  await withServer(async base => {
    const response=await fetch(`${base}/api/shared-pages`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Oops',messages:'not an array'})
    });
    assert.equal(response.status,400);
    assert.deepEqual(await response.json(),{error:'messages must be an array of strings'});
  });
});
