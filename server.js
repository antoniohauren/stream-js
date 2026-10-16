import http from 'node:http';
import https from 'node:https';
import {readFileSync} from 'node:fs';
import {createHmac, randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {WebSocket, WebSocketServer} from 'ws';

const assets = new Map([
  ['/', ['web/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['web/app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['web/style.css', 'text/css; charset=utf-8']],
]);

export function validRoom(room) {
  return /^[A-Za-z0-9-]{8,64}$/.test(room);
}

export function turnServer(urls, secret, id, expires) {
  const username = `${expires}:${id}`;
  return {urls, username, credential: createHmac('sha1', secret).update(username).digest('base64')};
}

export function configuration(env = process.env) {
  const bind = env.STREAMROOM_BIND || '127.0.0.1:8787';
  const match = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(bind);
  if (!match || !isIP(match[1] || match[2]) || Number(match[3]) > 65535) {
    throw new Error('STREAMROOM_BIND must be an IP:port (use [IPv6]:port for IPv6)');
  }
  const turnUrls = (env.STREAMROOM_TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
  const turnSecret = env.TURN_SECRET || '';
  const icePolicy = env.STREAMROOM_ICE_POLICY || 'all';
  if (!['all', 'relay'].includes(icePolicy)) throw new Error('STREAMROOM_ICE_POLICY must be all or relay');
  if (turnUrls.length && [...turnSecret].length < 32) throw new Error('TURN_SECRET must contain at least 32 characters when TURN is enabled');
  if (icePolicy === 'relay' && !turnUrls.length) throw new Error('Relay-only mode needs STREAMROOM_TURN_URLS');
  if (Boolean(env.STREAMROOM_CERT) !== Boolean(env.STREAMROOM_KEY)) throw new Error('Set both STREAMROOM_CERT and STREAMROOM_KEY');
  return {host: match[1] || match[2], port: Number(match[3]), turnUrls, turnSecret, icePolicy,
    cert: env.STREAMROOM_CERT, key: env.STREAMROOM_KEY};
}

// Each process owns its rooms; run a single replica, as in the original server.
export function createApp(config = configuration()) {
  const rooms = new Map();
  const handler = (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, {allow: 'GET, HEAD'}).end();
      return;
    }
    const path = req.url.split('?')[0];
    if (path === '/health') {
      res.writeHead(200, {'content-type': 'text/plain; charset=utf-8'}).end(req.method === 'HEAD' ? undefined : 'ok');
      return;
    }
    const asset = assets.get(path);
    if (!asset) { res.writeHead(404).end(); return; }
    try {
      // Read from disk rather than embedding assets: deploy client changes without compiling.
      const body = readFileSync(new URL(asset[0], import.meta.url));
      res.writeHead(200, {'content-type': asset[1], 'content-length': body.length,
        'cache-control': 'no-cache', 'x-content-type-options': 'nosniff'});
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      console.error('Unable to serve asset:', error.message);
      res.writeHead(500).end();
    }
  };
  const server = config.cert
    ? https.createServer({cert: readFileSync(config.cert), key: readFileSync(config.key)}, handler)
    : http.createServer(handler);
  const wss = new WebSocketServer({noServer: true, maxPayload: 65536, perMessageDeflate: false});
  function send(ws, value) {
    if (ws.readyState !== WebSocket.OPEN) return;
    // Bound slow-client queues rather than allowing unbounded memory growth.
    if (ws.bufferedAmount >= 128 * 65536) { ws.terminate(); return; }
    ws.send(JSON.stringify(value), error => { if (error) ws.terminate(); });
  }
  const broadcast = (room, value) => { for (const peer of room.peers.values()) send(peer.ws, value); };
  const reject = (socket, status, reason) => {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  server.on('upgrade', (req, socket, head) => {
    const host = req.headers.host;
    if (!host || ![`http://${host}`, `https://${host}`].includes(req.headers.origin)) {
      reject(socket, 403, 'Forbidden'); return;
    }
    let url, room, name;
    try {
      url = new URL(req.url, 'http://localhost');
      const match = /^\/ws\/([^/]+)$/.exec(url.pathname);
      if (!match) { reject(socket, 404, 'Not Found'); return; }
      room = decodeURIComponent(match[1]);
      name = url.searchParams.get('name');
    } catch { reject(socket, 400, 'Bad Request'); return; }
    if (!validRoom(room) || !name?.trim() || [...name].length > 32) {
      reject(socket, 400, 'Bad Request'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => join(ws, room, name.trim()));
  });
  function join(ws, key, name) {
    ws.on('error', () => ws.terminate());
    if (!rooms.has(key) && rooms.size >= 100) { ws.close(1008, 'Server room limit reached'); return; }
    const room = rooms.get(key) || {peers: new Map(), presenter: null};
    if (room.peers.size >= 8) {
      send(ws, {type: 'error', message: 'Room is full (8 people maximum).'});
      ws.close(1008, 'Room is full'); return;
    }
    rooms.set(key, room);
    const id = randomUUID();
    const iceServers = [{urls: 'stun:stun.l.google.com:19302'}];
    if (config.turnUrls.length) iceServers.push(turnServer(config.turnUrls, config.turnSecret, id, Math.floor(Date.now() / 1000) + 86400));
    send(ws, {type: 'welcome', id, members: [...room.peers].map(([id, peer]) => ({id, name: peer.name})),
      presenter: room.presenter, iceServers, iceTransportPolicy: config.icePolicy});
    const peer = {name, ws, lastSeen: Date.now()};
    room.peers.set(id, peer);
    broadcast(room, {type: 'joined', id, name});
    let window = Date.now(), count = 0;
    ws.on('ping', () => { peer.lastSeen = Date.now(); });
    ws.on('pong', () => { peer.lastSeen = Date.now(); });
    ws.on('message', (data, binary) => {
      if (binary) { ws.close(1003, 'Text messages only'); return; }
      const now = Date.now();
      peer.lastSeen = now;
      if (now - window >= 1000) { window = now; count = 0; }
      if (++count > 150) { ws.close(1008, 'Rate limit exceeded'); return; }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
      switch (msg.type) {
        case 'ping': send(ws, {type: 'pong'}); break;
        case 'start':
          if (room.presenter === null) {
            room.presenter = id;
            broadcast(room, {type: 'started', id});
          } else send(ws, {type: 'busy', message: 'Someone is already sharing.'});
          break;
        case 'stop':
          if (room.presenter === id) { room.presenter = null; broadcast(room, {type: 'stopped'}); }
          break;
        case 'signal':
          if (typeof msg.to === 'string' && (room.presenter === id || room.presenter === msg.to)) {
            const target = room.peers.get(msg.to);
            if (target) send(target.ws, {type: 'signal', from: id, data: msg.data ?? null});
          }
          break;
        case 'chat':
          if (typeof msg.body === 'string' && msg.body.trim() && [...msg.body].length <= 1000) {
            broadcast(room, {type: 'chat', name, body: msg.body});
          }
          break;
      }
    });
    ws.once('close', () => {
      room.peers.delete(id);
      if (room.presenter === id) { room.presenter = null; broadcast(room, {type: 'stopped'}); }
      broadcast(room, {type: 'left', id});
      if (!room.peers.size) rooms.delete(key);
    });
  }
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const peer of room.peers.values()) {
        if (Date.now() - peer.lastSeen >= 90000) peer.ws.terminate();
      }
    }
  }, 5000);
  heartbeat.unref();
  server.once('close', () => clearInterval(heartbeat));
  async function close() {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    await Promise.all([
      new Promise(resolve => wss.close(resolve)),
      new Promise(resolve => server.close(resolve)),
    ]);
  }
  return {server, rooms, close};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = configuration();
    const app = createApp(config);
    app.server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    app.server.listen(config.port, config.host, () => {
      console.log(`Streamroom listening on ${config.cert ? 'https' : 'http'}://${isIP(config.host) === 6 ? `[${config.host}]` : config.host}:${app.server.address().port}`);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      app.close().catch(error => { console.error(error); process.exitCode = 1; });
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
