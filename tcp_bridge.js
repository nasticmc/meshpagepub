import { isIP } from 'node:net';
import Constants from '@liamcottle/meshcore.js/src/constants.js';
import { MAX_POST_BYTES, normalizeRoomTarget, validateMessage } from './publisher.js';

const MAX_BODY_BYTES = 16 * 1024;
const CONNECT_TIMEOUT_MS = 12_000;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isAllowedLocalIpv4(host) {
  if (isIP(host) !== 4) return false;
  const [a,b] = host.split('.').map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

export function validateTcpTarget(hostValue, portValue = 5000) {
  const host = String(hostValue || '').trim();
  const portText = String(portValue ?? 5000).trim();
  const port = Number(portText);
  if (isIP(host) !== 4) throw httpError(400, 'Enter a literal local IPv4 address for the TCP companion.');
  if (!isAllowedLocalIpv4(host)) throw httpError(400, 'TCP companion address must be a local/private IPv4 address.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw httpError(400, 'TCP companion port must be a whole number from 1024 to 65535.');
  return {host, port};
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, oversized = false;
    const chunks = [];
    req.on('data', chunk => {
      if (oversized) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        oversized = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (oversized) return reject(httpError(413, 'Request body is too large.'));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(httpError(400, 'Request body must be valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','content-length':body.length,'cache-control':'no-store'});
  res.end(body);
}

function enforceSameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) throw httpError(403, 'TCP controls require a same-origin browser request.');
  let parsed;
  try { parsed = new URL(origin); } catch { throw httpError(403, 'Invalid request origin.'); }
  const protocol = req.socket.encrypted ? 'https:' : 'http:';
  const allowedHost = parsed.hostname.toLowerCase() === 'localhost' || isAllowedLocalIpv4(parsed.hostname);
  if (!allowedHost || parsed.host.toLowerCase() !== host.toLowerCase() || parsed.protocol !== protocol || req.headers['sec-fetch-site'] === 'cross-site') {
    throw httpError(403, 'TCP controls require a same-origin browser request.');
  }
}

async function defaultConnectionFactory(host, port) {
  const {default: TCPConnection} = await import('@liamcottle/meshcore.js/src/connection/tcp_connection.js');
  return new TCPConnection(host, port);
}

function waitForConnection(connection, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      connection.removeListener?.('connected', onConnected);
      connection.removeListener?.('disconnected', onDisconnected);
      connection.socket?.removeListener?.('error', onSocketError);
      error ? reject(error) : resolve();
    };
    const onConnected = () => finish();
    const onDisconnected = () => finish(new Error('TCP companion disconnected before initialization completed.'));
    const onSocketError = error => finish(new Error(`Could not connect to TCP companion: ${error.message}`));
    const timer = setTimeout(() => finish(new Error('TCP companion connection timed out. Check its IP, port, and network reachability.')), timeoutMs);
    connection.once('connected', onConnected);
    connection.once('disconnected', onDisconnected);
    Promise.resolve().then(() => connection.connect()).then(() => {
      connection.socket?.once?.('error', onSocketError);
    }).catch(error => finish(new Error(`Could not start TCP companion connection: ${error.message}`)));
  });
}

function normalizeKey(value) {
  return normalizeRoomTarget({kind:'room-server', publicKey:value});
}
function keyHex(key) { return [...key].map(byte => byte.toString(16).padStart(2,'0')).join(''); }
function roomContacts(contacts) {
  return contacts.filter(contact => contact.type === Constants.AdvType.Room).map(contact => ({
    publicKeyHex:keyHex(Uint8Array.from(contact.publicKey)),
    name:contact.advName || 'Unnamed room server',
    outPathLen:contact.outPathLen,
    lastAdvert:contact.lastAdvert,
  }));
}

export function createTcpBridge({connectionFactory = defaultConnectionFactory, connectTimeoutMs = CONNECT_TIMEOUT_MS} = {}) {
  let connection = null;
  let target = null;
  async function active() {
    if (!connection) throw httpError(409, 'Connect to a TCP companion first.');
    return connection;
  }
  async function closeActive() {
    const previous = connection;
    connection = null;
    target = null;
    if (previous) await previous.close();
  }
  return async function handleTcpRequest(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/tcp/')) return false;
    try {
      if (req.method !== 'POST') throw httpError(405, 'Use POST for TCP companion controls.');
      enforceSameOrigin(req);
      const body = await readJson(req);
      const action = url.pathname.slice('/api/tcp/'.length);
      if (action === 'connect') {
        const nextTarget = validateTcpTarget(body.host, body.port ?? 5000);
        await closeActive();
        const candidate = await connectionFactory(nextTarget.host, nextTarget.port);
        try { await waitForConnection(candidate, connectTimeoutMs); }
        catch (error) { await candidate.close?.(); throw error; }
        connection = candidate;
        target = nextTarget;
        candidate.once?.('disconnected', () => { if (connection === candidate) { connection = null; target = null; } });
        return sendJson(res, 200, {connected:true, host:target.host, port:target.port});
      }
      if (action === 'disconnect') {
        await closeActive();
        return sendJson(res, 200, {connected:false});
      }
      const radio = await active();
      if (action === 'contacts') {
        const contacts = roomContacts(await radio.getContacts());
        return sendJson(res, 200, {contacts});
      }
      if (action === 'login') {
        const key = normalizeKey(body.publicKey);
        if (typeof body.password !== 'string' || !body.password || body.password.length > 15) throw httpError(400, 'Enter a room password up to 15 characters long.');
        const contacts = roomContacts(await radio.getContacts());
        if (!contacts.some(contact => contact.publicKeyHex === keyHex(key))) throw httpError(400, 'Room server is not in the companion contact list.');
        const result = await radio.login(key, body.password);
        return sendJson(res, 200, {result});
      }
      if (action === 'send') {
        const key = normalizeKey(body.publicKey);
        if (typeof body.text !== 'string' || !body.text.trim()) throw httpError(400, 'Message cannot be empty.');
        const size = validateMessage(body.text, MAX_POST_BYTES);
        if (!size.valid) throw httpError(400, `Message exceeds the room-server limit of ${size.limit} UTF-8 bytes (${size.bytes} bytes).`);
        const result = await radio.sendTextMessage(key, body.text);
        return sendJson(res, 200, {result});
      }
      throw httpError(404, 'Unknown TCP companion action.');
    } catch (error) {
      if (res.headersSent) return true;
      const status = Number.isInteger(error.status) ? error.status : 502;
      sendJson(res, status, {error:error.message || 'TCP companion request failed.'});
      return true;
    }
  };
}
