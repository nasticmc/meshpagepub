import WebBleConnection from '@liamcottle/meshcore.js/src/connection/web_ble_connection.js';
import WebSerialConnection from '@liamcottle/meshcore.js/src/connection/web_serial_connection.js';
import Constants from '@liamcottle/meshcore.js/src/constants.js';

export const MAX_POST_BYTES = 151;
const encoder = new TextEncoder();
export function validateMessage(text, limit = MAX_POST_BYTES) {
  const bytes = encoder.encode(String(text)).length;
  return {bytes, limit, valid: bytes <= limit, remaining: limit - bytes};
}
export function reorderMessages(messages, from, to) {
  if (from < 0 || from >= messages.length || to < 0 || to >= messages.length) return [...messages];
  const next = [...messages], [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function splitMessages(values) {
  return values.map(value => String(value)).filter(value => value.trim());
}

export function normalizeRoomTarget(target) {
  if (target?.kind !== 'room-server') throw new Error('Choose a room-server node.');
  const hex = String(target.publicKey || '').replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 64) throw new Error('Room-server public key must be 64 hexadecimal characters.');
  return Uint8Array.from(hex.match(/.{2}/g), byte => parseInt(byte, 16));
}

export async function sendInOrder(messages, send, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), delayMs = 1500, isStopped = () => false, onProgress = () => {}) {
  const delay = Math.max(250, Number(delayMs) || 1500);
  for (let i = 0; i < messages.length; i++) {
    if (isStopped()) throw new Error('Queue stopped.');
    await send(messages[i]);
    onProgress(i + 1, messages.length);
    if (i < messages.length - 1) await wait(delay);
  }
}

export class MeshCorePublisher {
  constructor(connection) { this.connection = connection; }
  static async connectUsb() {
    if (!navigator.serial) throw new Error('Web Serial is unavailable. Use a Chromium browser over HTTPS or localhost.');
    const port = await navigator.serial.requestPort();
    await port.open({baudRate: 115200});
    const connection = new WebSerialConnection(port);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Radio did not finish initializing.')), 12000);
      connection.once('connected', () => { clearTimeout(timer); resolve(); });
      connection.once('disconnected', () => { clearTimeout(timer); reject(new Error('Radio disconnected during initialization.')); });
    });
    return new MeshCorePublisher(connection);
  }
  static async connectBluetooth() {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth is unavailable in this browser/device.');
    const connection = await WebBleConnection.open();
    if (!connection) throw new Error('No radio selected.');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Radio did not finish initializing.')), 12000);
      connection.once('connected', () => { clearTimeout(timer); resolve(); });
      connection.once('disconnected', () => { clearTimeout(timer); reject(new Error('Radio disconnected during initialization.')); });
    });
    return new MeshCorePublisher(connection);
  }
  async roomServers() {
    const contacts = await this.connection.getContacts();
    return contacts.filter(contact => contact.type === Constants.AdvType.Room).map(contact => ({
      publicKey: Uint8Array.from(contact.publicKey),
      publicKeyHex: [...contact.publicKey].map(byte => byte.toString(16).padStart(2,'0')).join(''),
      name: contact.advName || 'Unnamed room server',
      outPathLen: contact.outPathLen,
      lastAdvert: contact.lastAdvert,
    }));
  }
  async login(publicKey, password) {
    const key = normalizeRoomTarget({kind:'room-server',publicKey});
    const servers = await this.roomServers();
    const match = servers.find(server => server.publicKeyHex === [...key].map(byte => byte.toString(16).padStart(2,'0')).join(''));
    if (!match) throw new Error('Room server is not in the radio contact list. Refresh the list or enter its key manually.');
    return this.connection.login(key, password);
  }
  async sendMessage(publicKey, text) {
    const key = normalizeRoomTarget({kind:'room-server',publicKey});
    if (typeof text !== 'string' || !text.trim()) throw new Error('Message cannot be empty.');
    const size = validateMessage(text);
    if (!size.valid) throw new Error(`Message exceeds the room-server limit of ${size.limit} UTF-8 bytes (${size.bytes} bytes).`);
    return this.connection.sendTextMessage(key, text);
  }
  async close() { return this.connection.close(); }
}
