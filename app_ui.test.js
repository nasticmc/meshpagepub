import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

test('offers a generic phone preview in the editor UI', () => {
  const html=read('index.html');
  assert.match(html,/id="previewButton"[^>]*>Preview</);
  assert.match(html,/id="previewDialog"/);
  assert.match(html,/Phone preview/i);
  assert.doesNotMatch(`${html}${read('app.js')}${read('style.css')}${read('README.md')}`,/phone\s+6/i);
});

test('provides a local full emoji picker in each message editor', () => {
  const app=read('app.js'),pkg=JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies['emoji-picker-element']);
  assert.match(app,/import ['"]emoji-picker-element['"]/);
  assert.match(app,/document.createElement\(['"]emoji-picker['"]\)/);
  assert.match(app,/emoji-click/);
  assert.match(app,/\/assets\/emoji-data\.json/);
  const data=JSON.parse(read('assets/emoji-data.json'));
  assert.ok(data.length>1500,'picker data should contain the full standard emoji set');
});

test('removes the TCP bridge and its controls from the standard web app', () => {
  assert.doesNotMatch(read('index.html'),/tcpHost|tcpPort|tcpConnectButton|Connect TCP companion/);
  assert.doesNotMatch(read('app.js'),/TcpCompanionPublisher|tcpConnectButton/);
  assert.doesNotMatch(read('publisher.js'),/TcpCompanionPublisher|tcpRequest/);
  assert.doesNotMatch(read('server.js'),/api\/tcp|createTcpBridge/);
});

test('previews room messages as received with selectable phone sizes', () => {
  const html=read('index.html'),app=read('app.js'),css=read('style.css');
  assert.match(html,/id="phoneSizeSelect"/);
  assert.match(html,/value="compact"[^>]*data-width="360"[^>]*data-height="640"/);
  assert.match(html,/value="standard"[^>]*data-width="390"[^>]*data-height="844"/);
  assert.match(html,/value="large"[^>]*data-width="430"[^>]*data-height="932"/);
  assert.match(app,/phoneSizeSelect/);
  assert.match(app,/phone-post received/);
  assert.match(app,/Room member/);
  assert.match(css,/\.phone-post\{align-self:flex-start/);
  assert.match(css,/\.phone-bubble\{[^}]*border-radius:18px 18px 18px 4px/);
});

test('starts compact message fields as single-line and supports touch reordering', () => {
  const app=read('app.js'),css=read('style.css');
  assert.match(app,/Math\.max\(ta\.scrollHeight,48\)/);
  assert.match(app,/ta\.placeholder='Compose message…'/);
  assert.match(app,/ta\.rows=1/);
  assert.match(app,/pointerdown/);
  assert.match(app,/pointermove/);
  assert.match(app,/pointerup/);
  assert.match(app,/pointercancel/);
  assert.doesNotMatch(app,/draggable=true/);
  assert.match(css,/\.message textarea\{[^}]*min-height:48px/);
  assert.match(css,/\.message-rail button\{min-width:44px;min-height:44px/);
  assert.match(css,/\.drag-handle\{[^}]*touch-action:none/);
  assert.match(css,/\.message-rail\{[^}]*flex-direction:row/);
});

test('keeps the app editor-only with page save, load, import, and export', () => {
  const html=read('index.html'),app=read('app.js');
  assert.match(html,/<h1>MeshPage Editor<\/h1>/);
  assert.match(html,/id="saveOpenButton"[^>]*>Save page/);
  assert.match(html,/id="loadOpenButton"[^>]*>Load page/);
  assert.match(html,/id="importInput"/);
  assert.match(html,/id="exportButton"[^>]*>Export all pages/);
  assert.doesNotMatch(html,/connectionDialog|Connect USB|Bluetooth UART|roomPassword|Publish sequence|Stop queue|Clear room history/);
  assert.doesNotMatch(app,/MeshCorePublisher|sendInOrder|roomServerSelect|loginButton|sendButton|stopButton/);
  assert.match(read('publisher.js'),/class MeshCorePublisher/,'radio protocol helpers remain isolated for reuse outside this editor');
  assert.match(app,/obj\.pages\|\|obj\.lists\|\|obj/);
  assert.match(app,/pages:lists\(\)/);
  assert.match(html,/theme\.js/);
});

test('uses a 130-byte UTF-8 allowance for composer messages', () => {
  const html=read('index.html'),publisher=read('publisher.js');
  assert.match(html,/130 bytes maximum per message/);
  assert.match(publisher,/MAX_POST_BYTES = 130/);
});

test('uses per-message add and remove controls and preserves one editable message', () => {
  const app=read('app.js');
  assert.match(app,/makeControl\('add'/);
  assert.match(app,/makeControl\('remove'.*values\.length===1/s);
  assert.match(app,/if\(values\.length===1\)return/);
  assert.match(app,/reorderMessages\(messageValues\(\),from,to\)/);
});
