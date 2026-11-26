import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { splitMessages } from './publisher.js';

export const SHARED_PAGE_TTL_MS=7*24*60*60*1000;
const MAX_MESSAGES=100;
const MAX_VISIBLE_BYTES=32*1024;

function iso(now){return new Date(now).toISOString()}
function normaliseMessages(messages){
  if(!Array.isArray(messages)||!messages.every(message=>typeof message==='string'))throw new TypeError('messages must be an array of strings');
  const normalised=[];
  for(const message of messages){
    const chunks=splitMessages([message]);
    normalised.push(...(chunks.length?chunks:['']));
  }
  if(normalised.length>MAX_MESSAGES)throw new RangeError(`shared pages may contain at most ${MAX_MESSAGES} messages`);
  const bytes=new TextEncoder().encode(normalised.join('')).length;
  if(bytes>MAX_VISIBLE_BYTES)throw new RangeError(`shared pages may contain at most ${MAX_VISIBLE_BYTES} visible UTF-8 bytes`);
  return normalised;
}
function normaliseTitle(title){
  if(typeof title!=='string')throw new TypeError('title must be a string');
  return title.trim().slice(0,120);
}

export class CollaborationStore {
  constructor({filename,secret}){
    if(typeof filename!=='string'||!filename)throw new TypeError('filename is required');
    if(typeof secret!=='string'||secret.length<16)throw new TypeError('a durable collaboration code secret of at least 16 characters is required');
    this.secret=secret;
    this.db=new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS shared_pages (
        id TEXT PRIMARY KEY,
        code_hash BLOB NOT NULL UNIQUE,
        title TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        state_blob BLOB,
        created_at TEXT NOT NULL,
        last_edited_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS shared_pages_expires_at ON shared_pages(expires_at);
    `);
    const columns=this.db.prepare('PRAGMA table_info(shared_pages)').all().map(column=>column.name);
    if(!columns.includes('state_blob'))this.db.exec('ALTER TABLE shared_pages ADD COLUMN state_blob BLOB');
    this.insert=this.db.prepare('INSERT INTO shared_pages (id,code_hash,title,messages_json,created_at,last_edited_at,expires_at) VALUES (?,?,?,?,?,?,?)');
    this.byHash=this.db.prepare('SELECT id,title,messages_json,state_blob,expires_at FROM shared_pages WHERE code_hash=?');
    this.update=this.db.prepare('UPDATE shared_pages SET title=?,messages_json=?,last_edited_at=?,expires_at=? WHERE code_hash=?');
    this.updateState=this.db.prepare('UPDATE shared_pages SET title=?,messages_json=?,state_blob=?,last_edited_at=?,expires_at=? WHERE code_hash=?');
    this.deleteExpired=this.db.prepare('DELETE FROM shared_pages WHERE expires_at<=?');
  }

  close(){this.db.close()}
  hashCode(code){return createHmac('sha256',this.secret).update(code).digest()}
  createCode(){return `m_${randomBytes(16).toString('base64url')}`}
  createPage({title='',messages=[]},{now=Date.now()}={}){
    const code=this.createCode(),createdAt=iso(now),expiresAt=iso(now+SHARED_PAGE_TTL_MS),normalisedMessages=normaliseMessages(messages),normalisedTitle=normaliseTitle(title);
    const id=randomUUID();
    this.insert.run(id,this.hashCode(code),normalisedTitle,JSON.stringify(normalisedMessages),createdAt,createdAt,expiresAt);
    return {id,code,title:normalisedTitle,messages:normalisedMessages,expiresAt};
  }
  findByCode(code,{now=Date.now()}={}){
    if(typeof code!=='string')return null;
    const row=this.byHash.get(this.hashCode(code));
    if(!row||Date.parse(row.expires_at)<=now)return null;
    const page={id:row.id,title:row.title,messages:JSON.parse(row.messages_json),expiresAt:row.expires_at};
    if(row.state_blob)page.state=Buffer.from(row.state_blob);
    return page;
  }
  replacePage(code,{title='',messages=[]},{now=Date.now()}={}){
    const current=this.findByCode(code,{now});
    if(!current)return null;
    const normalisedTitle=normaliseTitle(title),normalisedMessages=normaliseMessages(messages),editedAt=iso(now),expiresAt=iso(now+SHARED_PAGE_TTL_MS);
    this.update.run(normalisedTitle,JSON.stringify(normalisedMessages),editedAt,expiresAt,this.hashCode(code));
    return {id:current.id,title:normalisedTitle,messages:normalisedMessages,expiresAt};
  }
  saveState(code,{title='',messages=[],state},{now=Date.now()}={}){
    if(!Buffer.isBuffer(state)&&!(state instanceof Uint8Array))throw new TypeError('state must be a binary update');
    const current=this.findByCode(code,{now});
    if(!current)return null;
    const normalisedTitle=normaliseTitle(title),normalisedMessages=normaliseMessages(messages),editedAt=iso(now),expiresAt=iso(now+SHARED_PAGE_TTL_MS);
    this.updateState.run(normalisedTitle,JSON.stringify(normalisedMessages),Buffer.from(state),editedAt,expiresAt,this.hashCode(code));
    return {id:current.id,title:normalisedTitle,messages:normalisedMessages,state:Buffer.from(state),expiresAt};
  }
  cleanupExpired({now=Date.now()}={}){return this.deleteExpired.run(iso(now)).changes}
}
