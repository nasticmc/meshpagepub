import * as Y from 'yjs';

function messageId(){
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  return `msg_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
function yText(value=''){const text=new Y.Text();text.insert(0,String(value));return text}
function pageMap(doc){return doc.getMap('page')}
function messagesArray(doc){
  const page=pageMap(doc);
  let messages=page.get('messages');
  if(!messages){messages=new Y.Array();page.set('messages',messages)}
  return messages;
}
function addMessage(messages,{id=messageId(),text=''}){
  const message=new Y.Map();
  message.set('id',id);
  message.set('text',yText(text));
  messages.push([message]);
}

export function createSharedPageDocument({title='',messages=[]}={}){
  const doc=new Y.Doc();
  doc.transact(()=>{
    const page=pageMap(doc);
    page.set('title',yText(title));
    const list=messagesArray(doc);
    for(const text of messages)addMessage(list,{text});
  });
  return doc;
}

export function sharedPageSnapshot(doc){
  const page=pageMap(doc),title=page.get('title'),messages=messagesArray(doc);
  return {
    title:title instanceof Y.Text?title.toString():'',
    messages:messages.toArray().map(message=>({
      id:String(message.get('id')),
      text:message.get('text') instanceof Y.Text?message.get('text').toString():''
    }))
  };
}
