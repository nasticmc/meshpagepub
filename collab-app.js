import * as Y from 'yjs';
import { splitMessages, validateMessage, MAX_POST_BYTES } from './publisher.js';
import { sharedPageSnapshot } from './collaboration-document.js';

const $=id=>document.getElementById(id);
const code=location.pathname.split('/').filter(Boolean).at(-1);
const remoteOrigin=Symbol('remote');
let doc=new Y.Doc(),socket=null,collaborators=[],reconnectTimer=null;
const nameKey='meshpagepub.collaboration.name';

function wsUrl(){return `${location.protocol==='https:'?'wss':'ws'}://${location.host}/collab/${code}`}
function messageId(){return globalThis.crypto?.randomUUID?.()||`msg_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`}
function pageMap(){return doc.getMap('page')}
function messageList(){const list=pageMap().get('messages');return list instanceof Y.Array?list:null}
function yText(value=''){const text=new Y.Text();text.insert(0,value);return text}
function makeMessage(text=''){const message=new Y.Map();message.set('id',messageId());message.set('text',yText(text));return message}
function replaceText(text,value){text.delete(0,text.length);text.insert(0,value)}
function status(text){$('sharedStatus').textContent=text}
function localName(){return $('displayName').value.trim()}
function sendPresence(activeMessageId=null){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'presence',name:localName(),...(activeMessageId?{activeMessageId}:{})}))}
function setConnection(text){$('connectionStatus').textContent=text}
function renderPresence(){
  const snapshot=sharedPageSnapshot(doc),names=collaborators.map(person=>{
    const active=snapshot.messages.find(message=>message.id===person.activeMessageId);
    return `${person.name}${active?` · editing message ${snapshot.messages.indexOf(active)+1}`:''}`;
  });
  $('collaborators').textContent=names.length?names.join(' · '):'No collaborators connected yet';
}
function focusMessage(id){requestAnimationFrame(()=>{const input=[...document.querySelectorAll('#sharedMessages textarea')].find(node=>node.dataset.id===id);input?.focus();input?.setSelectionRange(input.value.length,input.value.length)})}
function render(){
  const snapshot=sharedPageSnapshot(doc),list=messageList();
  $('sharedTitle').value=snapshot.title;
  const root=$('sharedMessages');root.replaceChildren();
  snapshot.messages.forEach((item,index)=>{
    const row=document.createElement('div');row.className='message';
    const editor=document.createElement('div');editor.className='message-editor';
    const top=document.createElement('div');top.className='message-toolbar';
    const label=document.createElement('strong');label.className='message-label';label.textContent=`Message ${index+1}`;
    const count=document.createElement('span');count.className='byte-count';
    const textarea=document.createElement('textarea');textarea.rows=1;textarea.dataset.id=item.id;textarea.value=item.text;textarea.placeholder='Compose message…';
    const resize=()=>{textarea.style.height='auto';textarea.style.height=`${Math.max(textarea.scrollHeight,48)}px`};
    const updateCount=()=>{const bytes=validateMessage(textarea.value).bytes;count.textContent=`${bytes}/${MAX_POST_BYTES} bytes`;count.classList.toggle('over-limit',bytes>MAX_POST_BYTES)};
    textarea.addEventListener('focus',()=>sendPresence(item.id));
    textarea.addEventListener('input',()=>{
      const chunks=splitMessages([textarea.value]);
      const values=chunks.length?chunks:[''];
      const position=list.toArray().findIndex(message=>message.get('id')===item.id);
      if(position<0)return;
      doc.transact(()=>{
        const message=list.get(position),text=message.get('text');replaceText(text,values[0]);
        if(values.length>1)list.insert(position+1,values.slice(1).map(makeMessage));
      });
      if(values.length>1){const continuation=list.get(position+values.length-1);render();focusMessage(continuation.get('id'))}else{updateCount();resize()}
    });
    const actions=document.createElement('div');actions.className='message-actions';
    const button=(label,text,disabled,handler)=>{const node=document.createElement('button');node.type='button';node.className='quiet message-control';node.textContent=text;node.title=label;node.setAttribute('aria-label',label);node.disabled=disabled;node.onclick=handler;return node};
    actions.append(
      button(`Remove message ${index+1}`,'×',snapshot.messages.length===1,()=>{if(snapshot.messages.length===1)return;doc.transact(()=>list.delete(index,1));render()}),
      button(`Move message ${index+1} up`,'↑',index===0,()=>move(index,index-1)),
      button(`Move message ${index+1} down`,'↓',index===snapshot.messages.length-1,()=>move(index,index+1)),
      button(`Add message below message ${index+1}`,'+',false,()=>{const next=makeMessage();doc.transact(()=>list.insert(index+1,[next]));render();focusMessage(next.get('id'))})
    );
    top.append(label,count);editor.append(top,textarea);row.append(editor,actions);root.append(row);updateCount();resize();
  });
  renderPresence();
}
function move(from,to){
  const list=messageList(),item=list.get(from),copy=makeMessage(item.get('text').toString());copy.set('id',item.get('id'));
  doc.transact(()=>{list.delete(from,1);list.insert(to,[copy])});render();
}
function updateTitle(){const title=pageMap().get('title');if(title instanceof Y.Text)doc.transact(()=>replaceText(title,$('sharedTitle').value))}
function copyShareLink(){navigator.clipboard?.writeText(location.href).then(()=>status('Share link copied.')).catch(()=>status('Copy the link from your browser address bar.'))}
function saveLocalCopy(){
  const snapshot=sharedPageSnapshot(doc),name=snapshot.title.trim()||'Shared page';
  try{const lists=JSON.parse(localStorage.getItem('meshpagepub.lists.v1')||'{}');lists[name]=snapshot.messages.map(message=>message.text);localStorage.setItem('meshpagepub.lists.v1',JSON.stringify(lists));status(`Saved “${name}” as a local copy.`)}catch{status('Could not save a local copy in this browser.')}
}
function renderExpiry(expiresAt){const days=Math.max(0,Math.ceil((Date.parse(expiresAt)-Date.now())/(24*60*60*1000)));$('sharedExpiry').textContent=`Expires in ${days} day${days===1?'':'s'} after the last content edit.`}
async function loadMetadata(){
  const response=await fetch(`/api/shared-pages/${code}`,{cache:'no-store'});
  if(!response.ok)throw Error('This shared page is unavailable or has expired.');
  const metadata=await response.json();$('joinDescription').textContent=`Join “${metadata.title||'Untitled shared page'}”. Choose the name collaborators will see while you edit.`;renderExpiry(metadata.expiresAt);
}
function connect(){
  if(!localName()){$('joinStatus').textContent='Enter a temporary name to join.';$('displayName').focus();return false}
  $('joinStatus').textContent='';
  sessionStorage.setItem(nameKey,localName());
  clearTimeout(reconnectTimer);setConnection('Connecting…');
  socket=new WebSocket(wsUrl());socket.binaryType='arraybuffer';
  socket.onopen=()=>{setConnection('Connected');socket.send(Y.encodeStateAsUpdate(doc));sendPresence()};
  socket.onmessage=event=>{
    if(typeof event.data==='string'){try{const message=JSON.parse(event.data);if(message.type==='presence'){collaborators=message.collaborators;renderPresence()}}catch{};return}
    Y.applyUpdate(doc,new Uint8Array(event.data),remoteOrigin);
  };
  socket.onclose=event=>{
    if(event.code===4004){setConnection('Expired');status('This shared page has expired.');return}
    setConnection('Reconnecting…');reconnectTimer=setTimeout(connect,1200);
  };
  socket.onerror=()=>setConnection('Connection error');
  return true;
}

doc.on('update',(update,origin)=>{if(origin!==remoteOrigin&&socket?.readyState===WebSocket.OPEN)socket.send(update);if(origin===remoteOrigin)render()});
$('joinButton').onclick=()=>{if(connect()){$('joinPanel').hidden=true;$('sharedComposer').hidden=false}};
$('displayName').value=sessionStorage.getItem(nameKey)||'';
$('sharedTitle').addEventListener('input',updateTitle);
$('sharedTitle').addEventListener('focus',()=>sendPresence());
$('sharedAddButton').onclick=()=>{const list=messageList();if(!list)return;const message=makeMessage();doc.transact(()=>list.push([message]));render();focusMessage(message.get('id'))};
$('copyShareButton').onclick=copyShareLink;
$('saveLocalCopyButton').onclick=saveLocalCopy;
$('leaveSharedButton').onclick=()=>{socket?.close();location.href='/'};
if(!/^m_[A-Za-z0-9_-]{22}$/.test(code)){ $('joinStatus').textContent='This share code is invalid.';$('joinButton').disabled=true; }
else loadMetadata().catch(cause=>{$('joinStatus').textContent=cause.message;$('joinButton').disabled=true});
