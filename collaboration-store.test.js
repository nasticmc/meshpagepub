import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CollaborationStore, SHARED_PAGE_TTL_MS } from './collaboration-store.js';

async function withStore(run) {
  const dir=await mkdtemp(path.join(tmpdir(),'meshpage-collab-'));
  const store=new CollaborationStore({filename:path.join(dir,'shared-pages.sqlite'),secret:'test-secret-for-shared-page-codes'});
  try { await run(store,dir); } finally { store.close(); await rm(dir,{recursive:true,force:true}); }
}

test('creates an opaque share code and persists normalized shared-page metadata', async () => {
  await withStore(async (store,dir) => {
    const now=Date.parse('2026-11-26T00:00:00.000Z');
    const page=store.createPage({title:'Field update',messages:['a'.repeat(131),'🌲']},{now});

    assert.match(page.code,/^m_[A-Za-z0-9_-]{22}$/);
    assert.equal(page.title,'Field update');
    assert.deepEqual(page.messages,['a'.repeat(130),'a','🌲']);
    assert.equal(Date.parse(page.expiresAt)-now,SHARED_PAGE_TTL_MS);

    const loaded=store.findByCode(page.code,{now});
    assert.deepEqual(loaded,{id:page.id,title:'Field update',messages:['a'.repeat(130),'a','🌲'],expiresAt:page.expiresAt});

    const database=await readFile(path.join(dir,'shared-pages.sqlite'));
    assert.equal(database.includes(Buffer.from(page.code)),false,'raw share code must not be persisted');
  });
});

test('extends expiry only when shared content changes', async () => {
  await withStore(async store => {
    const createdAt=Date.parse('2026-11-26T00:00:00.000Z');
    const page=store.createPage({title:'Draft',messages:['one']},{now:createdAt});
    const unchanged=store.findByCode(page.code,{now:createdAt+60_000});
    assert.equal(unchanged.expiresAt,page.expiresAt);

    const editedAt=createdAt+60_000;
    const updated=store.replacePage(page.code,{title:'Draft two',messages:['two']},{now:editedAt});
    assert.equal(Date.parse(updated.expiresAt)-editedAt,SHARED_PAGE_TTL_MS);
    assert.equal(updated.title,'Draft two');
    assert.deepEqual(updated.messages,['two']);
  });
});

test('persists an opaque collaboration state update across store instances', async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'meshpage-collab-'));
  const filename=path.join(dir,'shared-pages.sqlite'),secret='test-secret-for-shared-page-codes';
  try {
    const first=new CollaborationStore({filename,secret});
    const page=first.createPage({title:'Draft',messages:['one']},{now:0});
    const state=Buffer.from([1,2,3,4]);
    first.saveState(page.code,{title:'Changed',messages:['two'],state},{now:60_000});
    first.close();

    const reopened=new CollaborationStore({filename,secret});
    const loaded=reopened.findByCode(page.code,{now:60_000});
    assert.equal(loaded.title,'Changed');
    assert.deepEqual(loaded.messages,['two']);
    assert.deepEqual(loaded.state,state);
    assert.equal(Date.parse(loaded.expiresAt)-60_000,SHARED_PAGE_TTL_MS);
    reopened.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('rejects expired shared pages and cleans them from persistent storage', async () => {
  await withStore(async store => {
    const createdAt=Date.parse('2026-11-26T00:00:00.000Z');
    const page=store.createPage({title:'Draft',messages:['one']},{now:createdAt});
    const expiredAt=createdAt+SHARED_PAGE_TTL_MS+1;

    assert.equal(store.findByCode(page.code,{now:expiredAt}),null);
    assert.equal(store.cleanupExpired({now:expiredAt}),1);
    assert.equal(store.findByCode(page.code,{now:expiredAt}),null);
  });
});
