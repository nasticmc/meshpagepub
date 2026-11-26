#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import { CollaborationStore } from './collaboration-store.js';
import { createSharedPageDocument, sharedPageSnapshot } from './collaboration-document.js';

const moduleRoot=path.dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const MAX_JSON_BYTES=64*1024;
const MAX_UPDATE_BYTES=64*1024;

function json(res,status,body){
  const encoded=JSON.stringify(body);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(encoded),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(encoded);
}
function error(res,status,message){json(res,status,{error:message})}
function upgradeError(socket,status,message){socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);socket.destroy()}
function defaultDataDir(){return process.env.MESHPAGEPUB_DATA_DIR||path.join(process.env.XDG_STATE_HOME||path.join(os.homedir(),'.local','state'),'meshpagepub')}
function collaborationSecret(dataDir,configured){
  if(configured)return configured;
  const filename=path.join(dataDir,'collaboration-secret');
  try{return fs.readFileSync(filename,'utf8').trim()}catch(cause){if(cause.code!=='ENOENT')throw cause}
  const secret=randomBytes(32).toString('base64url');
  try{fs.writeFileSync(filename,`${secret}\n`,{mode:0o600,flag:'wx'});fs.chmodSync(filename,0o600);return secret}catch(cause){if(cause.code==='EEXIST')return fs.readFileSync(filename,'utf8').trim();throw cause}
}
function readJson(req){
  return new Promise((resolve,reject)=>{
    let size=0,body='';
    req.setEncoding('utf8');
    req.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>MAX_JSON_BYTES){reject(new RangeError('request body is too large'));req.destroy();return}body+=chunk});
    req.on('end',()=>{try{resolve(JSON.parse(body||'{}'))}catch{reject(new SyntaxError('request body must be valid JSON'))}});
    req.on('error',reject);
  });
}
function shareCodeFromPath(pathname){
  const match=pathname.match(/^\/api\/shared-pages\/(m_[A-Za-z0-9_-]{22})$/);
  return match?.[1]||null;
}
function collabCodeFromPath(pathname){
  const match=pathname.match(/^\/collab\/(m_[A-Za-z0-9_-]{22})$/);
  return match?.[1]||null;
}
function serveStatic(root,pathname,res){
  let requested;
  try{requested=pathname==='/'?'index.html':/^\/share\/m_[A-Za-z0-9_-]{22}$/.test(pathname)?'share.html':decodeURIComponent(pathname).replace(/^\/+/, '')}catch{return error(res,400,'Bad request')}
  const file=path.resolve(root,requested);
  if(!file.startsWith(root+path.sep))return error(res,403,'Forbidden');
  fs.stat(file,(err,stat)=>{
    if(err||!stat.isFile())return error(res,404,'Not found');
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});
    fs.createReadStream(file).pipe(res);
  });
}

export function createMeshPageServer({root=moduleRoot,dataDir=defaultDataDir(),codeSecret=process.env.MESHPAGEPUB_SHARE_CODE_SECRET}={}){
  fs.mkdirSync(dataDir,{recursive:true});
  const store=new CollaborationStore({filename:path.join(dataDir,'shared-pages.sqlite'),secret:collaborationSecret(dataDir,codeSecret)});
  const rooms=new Map();
  const expiryTimer=setInterval(()=>{
    store.cleanupExpired();
    for(const [code,room] of rooms)if(!store.findByCode(code)){for(const socket of room.sockets)socket.close(4004,'Shared page expired');room.doc.destroy();rooms.delete(code)}
  },60*60*1000);
  expiryTimer.unref();
  const webSocketServer=new WebSocketServer({noServer:true,maxPayload:MAX_UPDATE_BYTES,clientTracking:false});
  const loadRoom=(code,page)=>{
    let room=rooms.get(code);
    if(room)return room;
    const doc=page.state?new Y.Doc():createSharedPageDocument({title:page.title,messages:page.messages});
    if(page.state)Y.applyUpdate(doc,page.state);
    room={doc,sockets:new Set(),presence:new Map()};
    room.broadcastPresence=()=>{
      const collaborators=[...room.presence.values()].sort((a,b)=>a.name.localeCompare(b.name));
      const message=JSON.stringify({type:'presence',collaborators});
      for(const socket of room.sockets)if(socket.readyState===WebSocket.OPEN)socket.send(message);
    };
    room.doc.on('update',(update,origin)=>{
      const snapshot=sharedPageSnapshot(room.doc);
      const saved=store.saveState(code,{title:snapshot.title,messages:snapshot.messages.map(message=>message.text),state:Y.encodeStateAsUpdate(room.doc)});
      if(!saved){for(const socket of room.sockets)socket.close(4004,'Shared page expired');rooms.delete(code);return}
      for(const socket of room.sockets)if(socket!==origin&&socket.readyState===WebSocket.OPEN)socket.send(update,{binary:true});
    });
    rooms.set(code,room);
    return room;
  };
  const server=http.createServer(async (req,res)=>{
    let url;
    try{url=new URL(req.url,'http://localhost')}catch{return error(res,400,'Bad request')}
    const {pathname}=url;
    if(req.method==='GET'&&pathname==='/health')return json(res,200,{ok:true,collaboration:Boolean(store)});
    if(pathname==='/api/shared-pages'&&req.method==='POST'){
      if(!store)return error(res,503,'Collaboration is not configured');
      try{
        const page=store.createPage(await readJson(req));
        return json(res,201,{code:page.code,shareUrl:`/share/${page.code}`,expiresAt:page.expiresAt});
      }catch(cause){return error(res,400,cause.message||'Invalid shared page')}
    }
    const code=shareCodeFromPath(pathname);
    if(code&&req.method==='GET'){
      if(!store)return error(res,503,'Collaboration is not configured');
      const page=store.findByCode(code);
      return page?json(res,200,{title:page.title,expiresAt:page.expiresAt,expired:false}):error(res,404,'Shared page not found or expired');
    }
    if(pathname.startsWith('/api/'))return error(res,404,'Not found');
    if(req.method!=='GET'&&req.method!=='HEAD')return error(res,405,'Method not allowed');
    return serveStatic(root,pathname,res);
  });
  server.on('upgrade',(req,socket,head)=>{
    let url;
    try{url=new URL(req.url,'http://localhost')}catch{return upgradeError(socket,400,'Bad Request')}
    const code=collabCodeFromPath(url.pathname);
    if(!code)return upgradeError(socket,404,'Not Found');
    if(!store)return upgradeError(socket,503,'Service Unavailable');
    const page=store.findByCode(code);
    if(!page)return upgradeError(socket,404,'Not Found');
    webSocketServer.handleUpgrade(req,socket,head,client=>webSocketServer.emit('connection',client,{code,page}));
  });
  webSocketServer.on('connection',(socket,{code,page})=>{
    const room=loadRoom(code,page);
    if(room.sockets.size>=10)return socket.close(1013,'Shared page is full');
    room.sockets.add(socket);
    socket.send(Y.encodeStateAsUpdate(room.doc),{binary:true});
    socket.on('message',(data,isBinary)=>{
      if(isBinary){
        if(data.length>MAX_UPDATE_BYTES)return socket.close(1003,'Expected a bounded binary update');
        try{Y.applyUpdate(room.doc,new Uint8Array(data),socket)}catch{socket.close(1003,'Invalid collaboration update')}
        return;
      }
      try{
        const message=JSON.parse(String(data));
        if(message.type!=='presence')throw Error();
        const name=typeof message.name==='string'?message.name.trim():'';
        if(!name||name.length>32)throw Error();
        const activeMessageId=typeof message.activeMessageId==='string'&&message.activeMessageId.length<=128?message.activeMessageId:null;
        room.presence.set(socket,{name,...(activeMessageId?{activeMessageId}:{})});
        room.broadcastPresence();
      }catch{socket.close(1003,'Invalid collaboration presence')}
    });
    socket.on('close',()=>{room.sockets.delete(socket);if(room.presence.delete(socket))room.broadcastPresence();if(!room.sockets.size){room.doc.destroy();rooms.delete(code)}});
  });
  server.on('close',()=>{clearInterval(expiryTimer);for(const room of rooms.values())for(const socket of room.sockets)socket.terminate();webSocketServer.close();store.close()});
  return server;
}

function option(args,name,fallback){const i=args.indexOf(name);return i<0?fallback:args[i+1]}
function lanUrls(port){return Object.values(os.networkInterfaces()).flat().filter(x=>x&&x.family==='IPv4'&&!x.internal).map(x=>`http://${x.address}:${port}/`)}
function isDirectExecution(){return process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)}

if(isDirectExecution()){
  const args=process.argv.slice(2),host=option(args,'--host','0.0.0.0'),port=Number(option(args,'--port','8000'));
  const server=createMeshPageServer();
  server.listen(port,host,()=>{
    console.log(`Serving ${moduleRoot} on ${host}:${port}`);
    for(const url of lanUrls(port))console.log(`Network URL: ${url}`);
  });
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
