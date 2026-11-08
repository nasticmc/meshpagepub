import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createTcpBridge, validateTcpTarget } from './tcp_bridge.js';

test('TCP targets allow private IPv4 companions and validate their ports', () => {
  assert.deepEqual(validateTcpTarget('192.168.1.42', 5000), {host:'192.168.1.42', port:5000});
  assert.deepEqual(validateTcpTarget('10.0.0.5', '5001'), {host:'10.0.0.5', port:5001});
  assert.deepEqual(validateTcpTarget('100.79.90.122', 5000), {host:'100.79.90.122', port:5000});
  assert.throws(() => validateTcpTarget('8.8.8.8', 5000), /private IPv4/);
  assert.throws(() => validateTcpTarget('meshcore.local', 5000), /literal local IPv4/);
  assert.throws(() => validateTcpTarget('192.168.1.42', 80), /port/);
});

test('same-origin TCP bridge connects, lists contacts, logs in, sends, and disconnects', async t => {
  const calls=[];
  class FakeConnection extends EventEmitter {
    async connect() { queueMicrotask(()=>this.emit('connected')); }
    async getContacts() { return [{type:3, publicKey:Uint8Array.from({length:32},(_,i)=>i), advName:'Room A', outPathLen:1,lastAdvert:123}]; }
    async login(key,password) { calls.push(['login',[...key],password]); return {permissions:1}; }
    async sendTextMessage(key,text) { calls.push(['send',[...key],text]); return {success:true}; }
    async close() { calls.push(['close']); this.emit('disconnected'); }
  }
  const bridge=createTcpBridge({connectionFactory:async (host,port)=>{calls.push(['connect',host,port]);return new FakeConnection();}});
  const server=http.createServer((req,res)=>bridge(req,res));
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(path,body,origin=base) {
    const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body??{})});
    return {status:response.status,body:await response.json()};
  }
  assert.equal((await request('/api/tcp/connect',{host:'192.168.1.42',port:5000})).status,200);
  const rooms=await request('/api/tcp/contacts');
  assert.equal(rooms.status,200); assert.equal(rooms.body.contacts[0].name,'Room A');
  const key='000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
  assert.equal((await request('/api/tcp/login',{publicKey:key,password:'guest'})).status,200);
  assert.equal((await request('/api/tcp/send',{publicKey:key,text:'hello'})).status,200);
  assert.equal((await request('/api/tcp/disconnect')).status,200);
  assert.deepEqual(calls.map(call=>call[0]),['connect','login','send','close']);
  assert.equal((await request('/api/tcp/connect',{host:'192.168.1.42',port:5000},'http://evil.example')).status,403);
  const oversized=await fetch(base+'/api/tcp/connect',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({host:'192.168.1.42',padding:'x'.repeat(20*1024)})});
  assert.equal(oversized.status,413);
  assert.match((await oversized.json()).error,/too large/);
  const rebinding=await new Promise((resolve,reject)=>{
    const req=http.request(base+'/api/tcp/disconnect',{method:'POST',headers:{host:'evil.example',origin:'http://evil.example','content-type':'application/json'}},res=>{
      let data='';res.setEncoding('utf8');res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));
    });
    req.on('error',reject);req.end('{}');
  });
  assert.equal(rebinding.status,403);
});
