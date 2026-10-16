import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {WebSocket} from 'ws';
import {configuration, createApp, turnServer, validRoom} from '../server.js';

async function setup(t, env = {}) {
  const config = configuration({...env, STREAMROOM_BIND: '127.0.0.1:0'});
  const app = createApp(config);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  async function connect(name = 'Alice', room = 'room-1') {
    const ws = new WebSocket(`${origin.replace('http', 'ws')}/ws/${room}?name=${encodeURIComponent(name)}`, {origin});
    const messages = [];
    const waiters = [];
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      const i = waiters.findIndex(w => w.type === msg.type);
      if (i < 0) messages.push(msg);
      else waiters.splice(i, 1)[0].resolve(msg);
    });
    const next = type => {
      const i = messages.findIndex(m => m.type === type);
      if (i >= 0) return Promise.resolve(messages.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2000);
        waiters.push({type, resolve: value => { clearTimeout(timer); resolve(value); }});
      });
    };
    await once(ws, 'open');
    return {ws, next, send: value => ws.send(JSON.stringify(value))};
  }
  return {...app, origin, connect};
}

test('only the three precreated rooms are valid', () => {
  for (const room of ['room-1', 'room-2', 'room-3']) assert.ok(validRoom(room));
  for (const bad of ['room-4', 'a1b2c3d4-5678', 'short', '../private', 'room name', 'abcdefgh/', 'a'.repeat(65), 'é'.repeat(8)]) assert.equal(validRoom(bad), false);
});

test('Coturn credentials match the existing HMAC-SHA1 reference', () => {
  assert.deepEqual(turnServer(['turn:example.com:3478'], 'example-secret-01234567890123456789', 'alice', 1700000000), {
    urls: ['turn:example.com:3478'], username: '1700000000:alice', credential: '8v8E1nizkrUAhoXf7jGB6Z5AK9Y=',
  });
});

test('configuration fails closed for invalid TURN, TLS and bind settings', () => {
  for (const env of [
    {STREAMROOM_ICE_POLICY: 'invalid'}, {STREAMROOM_ICE_POLICY: 'relay'},
    {STREAMROOM_TURN_URLS: 'turn:example.com'}, {STREAMROOM_CERT: 'cert.pem'},
    {STREAMROOM_KEY: 'key.pem'}, {STREAMROOM_BIND: 'localhost:8787'},
    {STREAMROOM_BIND: '127.0.0.1:65536'},
  ]) assert.throws(() => configuration(env));
  assert.equal(configuration({STREAMROOM_BIND: '[::1]:8787'}).host, '::1');
});

test('HTTP serves the client, health and HEAD without exposing arbitrary files', async t => {
  const {origin} = await setup(t);
  for (const [path, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/style.css', 'text/css'], ['/health', 'text/plain']]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.ok((await response.text()).length);
  }
  assert.equal(await (await fetch(origin + '/health')).text(), 'ok');
  assert.equal(await (await fetch(origin + '/', {method: 'HEAD'})).text(), '');
  assert.equal((await fetch(origin + '/server.js')).status, 404);
  assert.equal((await fetch(origin + '/', {method: 'POST'})).status, 405);
});

test('WebSocket upgrades require same origin and valid room/name', async t => {
  const {origin} = await setup(t);
  async function upgrade(path, requestOrigin) {
    return new Promise((resolve, reject) => {
      const req = http.request(origin + path, {headers: {
        connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', ...(requestOrigin ? {origin: requestOrigin} : {}),
      }}, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
  }
  assert.equal(await upgrade('/ws/room-1?name=Alice'), 403);
  assert.equal(await upgrade('/ws/room-1?name=Alice', 'https://evil.example'), 403);
  assert.equal(await upgrade('/ws/short?name=Alice', origin), 400);
  assert.equal(await upgrade('/ws/custom-room?name=Alice', origin), 400);
  assert.equal(await upgrade('/ws/room-1?name=%20', origin), 400);
  assert.equal(await upgrade(`/ws/room-1?name=${'a'.repeat(33)}`, origin), 400);
});

test('rooms preserve joins, presenter arbitration, signaling and departure cleanup', async t => {
  const app = await setup(t);
  const alice = await app.connect(' Alice ');
  const a = await alice.next('welcome');
  assert.deepEqual(a.members, []);
  assert.equal(a.presenter, null);
  const bob = await app.connect('Bob');
  const b = await bob.next('welcome');
  assert.deepEqual(b.members, [{id: a.id, name: 'Alice'}]);
  await alice.next('joined'); // self notification
  assert.equal((await alice.next('joined')).id, b.id);
  alice.send({type: 'start'});
  assert.equal((await bob.next('started')).id, a.id);
  bob.send({type: 'start'});
  assert.equal((await bob.next('busy')).message, 'Someone is already sharing.');
  bob.send({type: 'stop'}); // viewer cannot release the presenter slot
  bob.send({type: 'ping'});
  await bob.next('pong');
  assert.equal(app.rooms.get('room-1').presenter, a.id);
  bob.send({type: 'signal', to: a.id, data: {candidate: 'ice'}});
  assert.deepEqual(await alice.next('signal'), {type: 'signal', from: b.id, data: {candidate: 'ice'}});
  alice.ws.close();
  await bob.next('stopped');
  assert.equal((await bob.next('left')).id, a.id);
  bob.send({type: 'start'});
  assert.equal((await bob.next('started')).id, b.id);
  bob.send({type: 'stop'});
  await bob.next('stopped');
  const left = once(bob.ws, 'close');
  bob.ws.close();
  await left;
  // A close handshake can complete client-side before the server's close event.
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([...app.rooms.keys()], ['room-1', 'room-2', 'room-3']);
  assert.equal(app.rooms.get('room-1').peers.size, 0);
  assert.equal(app.rooms.get('room-1').presenter, null);
});

test('viewer-to-viewer and cross-room signaling are not relayed', async t => {
  const app = await setup(t);
  const host = await app.connect('Host'), a = await host.next('welcome');
  const viewer = await app.connect('Viewer'), b = await viewer.next('welcome');
  const other = await app.connect('Other', 'room-2'), c = await other.next('welcome');
  host.send({type: 'start'});
  await viewer.next('started');
  viewer.send({type: 'signal', to: b.id, data: 'not allowed'});
  host.send({type: 'signal', to: c.id, data: 'not allowed'});
  const received = [];
  viewer.ws.on('message', raw => received.push(JSON.parse(raw)));
  other.ws.on('message', raw => received.push(JSON.parse(raw)));
  viewer.send({type: 'ping'}); other.send({type: 'ping'}); host.send({type: 'ping'});
  await Promise.all([viewer.next('pong'), other.next('pong'), host.next('pong')]);
  assert.equal(received.some(m => m.type === 'signal'), false);
  assert.equal(app.rooms.get('room-1').presenter, a.id);
});

test('TURN configuration is included in welcome without leaking the shared secret', async t => {
  const secret = 'example-secret-01234567890123456789';
  const app = await setup(t, {STREAMROOM_TURN_URLS: 'turn:example.com:3478, turns:example.com:5349', TURN_SECRET: secret, STREAMROOM_ICE_POLICY: 'relay'});
  const peer = await app.connect();
  const welcome = await peer.next('welcome');
  assert.equal(welcome.iceTransportPolicy, 'relay');
  const turn = welcome.iceServers[1];
  const expires = Number(turn.username.split(':')[0]);
  assert.ok(expires >= Math.floor(Date.now() / 1000) + 86395);
  assert.deepEqual(turn, turnServer(['turn:example.com:3478', 'turns:example.com:5349'], secret, welcome.id, expires));
  assert.equal(JSON.stringify(welcome).includes(secret), false);
});

test('room capacity is eight and empty rooms release capacity', async t => {
  const app = await setup(t);
  const peers = [];
  for (let i = 0; i < 8; i++) { const p = await app.connect(`Peer ${i}`); await p.next('welcome'); peers.push(p); }
  const ninth = await app.connect('Ninth');
  assert.match((await ninth.next('error')).message, /Room is full/);
  assert.equal(app.rooms.get('room-1').peers.size, 8);
  const closed = once(peers[0].ws, 'close'); peers[0].ws.close(); await closed;
  await peers[1].next('left');
  const replacement = await app.connect('Replacement');
  assert.equal((await replacement.next('welcome')).members.length, 7);
});

test('malformed JSON is ignored and rate/payload limits close abusive clients', async t => {
  const app = await setup(t);
  const peer = await app.connect(); await peer.next('welcome');
  for (const value of ['{', 'null', '[]', '42']) peer.ws.send(value);
  peer.send({type: 'chat', body: ' '.repeat(10)});
  peer.send({type: 'chat', body: 'a'.repeat(1001)});
  peer.send({type: 'ping'}); await peer.next('pong');
  const limited = once(peer.ws, 'close');
  for (let i = 0; i < 151; i++) peer.send({type: 'ping'});
  assert.equal((await limited)[0], 1008);
  const huge = await app.connect('Huge'); await huge.next('welcome');
  const oversized = once(huge.ws, 'close');
  huge.ws.send('a'.repeat(65537));
  assert.equal((await oversized)[0], 1009);
});
