import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=name=>readFileSync(new URL(`./${name}`,import.meta.url),'utf8');

test('provides a standalone shared-page join composer with temporary presence', () => {
  const html=read('share.html'),app=read('collab-app.js');
  assert.match(html,/id="displayName"/);
  assert.match(html,/id="joinButton"[^>]*>Join shared page</);
  assert.match(html,/id="sharedTitle"/);
  assert.match(html,/id="sharedMessages"/);
  assert.match(html,/id="joinStatus"/);
  assert.match(html,/id="collaborators"/);
  assert.match(html,/id="leaveSharedButton"/);
  assert.match(html,/src="\/?collab\.bundle\.js"/);
  assert.match(app,/new WebSocket/);
  assert.match(app,/type:'presence'/);
  assert.match(app,/splitMessages/);
  assert.match(app,/sharedPageSnapshot/);
});

test('offers sharing and code join entry points from the local editor', () => {
  const html=read('index.html'),app=read('app.js');
  assert.match(html,/id="shareCurrentButton"[^>]*>Share current page</);
  assert.match(html,/id="joinCode"/);
  assert.match(html,/id="joinCodeButton"[^>]*>Join</);
  assert.match(html,/id="shareDialog"/);
  assert.match(app,/api\/shared-pages/);
  assert.match(app,/shareCurrentButton/);
  assert.match(app,/joinCodeButton/);
});
