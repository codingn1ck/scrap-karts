// Scrap Karts relay server.
// Serves index.html and relays each player's state to everyone else in the same room.
// It does no game logic: every client is the authority for its own kart.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PER_ROOM = 12;
const page = fs.readFileSync(path.join(__dirname, 'index.html'));
const ASSETS = path.join(__dirname, 'assets');
const TYPES = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };

// Static files under /assets (3D models, textures, licence files). Nothing outside assets/ is reachable.
function serveAsset(url, res) {
  let rel; try { rel = decodeURIComponent(url.slice('/assets/'.length)); } catch { rel = ''; }
  const file = path.join(ASSETS, rel), type = TYPES[path.extname(file).toLowerCase()];
  if (!rel || !type || !file.startsWith(ASSETS + path.sep)) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(page);
  } else if (url.startsWith('/assets/')) {
    serveAsset(url, res);
  } else if (url === '/health') {
    res.end('ok');
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });
const rooms = new Map();
let nextId = 1;

wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const room = (q.get('room') || 'arena').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 20) || 'arena';
  if (!rooms.has(room)) rooms.set(room, new Set());
  const members = rooms.get(room);
  if (members.size >= MAX_PER_ROOM) { ws.send(JSON.stringify({ t: 'full' })); ws.close(); return; }

  ws.id = 'p' + (nextId++).toString(36) + Math.random().toString(36).slice(2, 6);
  ws.p = null; ws.alive = true;
  members.add(ws);
  ws.send(JSON.stringify({ t: 'hello', id: ws.id, peers: [...members].filter(o => o !== ws && o.p).map(o => ({ id: o.id, p: o.p })) }));

  let windowStart = Date.now(), count = 0;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', buf => {
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; count = 0; }
    if (++count > 60) return; // simple flood guard
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (!m || m.t !== 'p' || !m.p || typeof m.p !== 'object') return;
    ws.p = m.p;
    const out = JSON.stringify({ t: 'p', id: ws.id, p: m.p });
    for (const o of members) if (o !== ws && o.readyState === 1) o.send(out);
  });
  ws.on('close', () => {
    members.delete(ws);
    const out = JSON.stringify({ t: 'l', id: ws.id });
    for (const o of members) if (o.readyState === 1) o.send(out);
    if (!members.size) rooms.delete(room);
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log('Scrap Karts running on http://localhost:' + PORT));
