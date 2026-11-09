import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

test('offers a generic phone preview in the publisher UI', () => {
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
