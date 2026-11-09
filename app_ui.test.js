import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

test('offers an iPhone 6 message preview in the publisher UI', () => {
  const html=read('index.html');
  assert.match(html,/id="previewButton"/);
  assert.match(html,/id="previewDialog"/);
  assert.match(html,/375/);
  assert.match(html,/667/);
});

test('removes the TCP bridge and its controls from the standard web app', () => {
  assert.doesNotMatch(read('index.html'),/tcpHost|tcpPort|tcpConnectButton|Connect TCP companion/);
  assert.doesNotMatch(read('app.js'),/TcpCompanionPublisher|tcpConnectButton/);
  assert.doesNotMatch(read('publisher.js'),/TcpCompanionPublisher|tcpRequest/);
  assert.doesNotMatch(read('server.js'),/api\/tcp|createTcpBridge/);
});
