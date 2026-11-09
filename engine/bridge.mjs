// HTTP bridge between the web app (RemoteEngine) and the native C++ engine.
//   node engine/bridge.mjs [path/to/ll_engine]     -> http://localhost:8787
// Then open the app with  ?engine=http://localhost:8787
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { CATALOG } from '../src/core/catalog.js';

const PORT = +(process.env.PORT || 8787);
const candidates = [process.argv[2], 'engine/cpp/build/ll_engine.exe', 'engine/cpp/build/ll_engine', 'engine/cpp/build/Release/ll_engine.exe'].filter(Boolean);
const BIN = candidates.find((p) => existsSync(p));
if (!BIN) { console.error('ll_engine binary not found. Build it first (see engine/cpp/README.md).'); process.exit(1); }

const ACCESS = { front: 1, left: 2, right: 4 };
function toText(project, restarts = 2, iterScale = 1) {
  const { room, items } = project;
  const L = [`room ${room.width} ${room.length} ${room.height}`];
  for (const d of room.doors || []) L.push(`door ${d.wall} ${d.offset} ${d.width}`);
  for (const w of room.windows || []) L.push(`window ${w.wall} ${w.offset} ${w.width} ${w.sill} ${w.height}`);
  for (const it of items) {
    const c = CATALOG[it.type]; const cl = c.clearance || {};
    const collide = c.collide !== false, obstacle = collide && it.h > 0.05 && !c.tuckUnder;
    const acc = (c.access || []).reduce((m, s) => m | ACCESS[s], 0);
    L.push(`item ${it.id} ${it.type} ${it.x} ${it.z} ${it.rot} ${it.w} ${it.d} ${it.h} ${+!!it.locked} ${+collide} ${+obstacle} ${+(c.wall === 'back')} ${cl.front || 0} ${cl.sides || 0} ${cl.back || 0} ${acc}`);
  }
  L.push(`opt ${restarts} ${iterScale}`);
  return L.join('\n') + '\n';
}

function run(project, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`engine exited ${code}`));
      const byId = Object.fromEntries(project.items.map((it) => [it.id, it]));
      const suggestions = []; let cur = null, meta = {};
      for (const line of out.split(/\r?\n/)) {
        const t = line.trim().split(/\s+/);
        if (t[0] === 'meta') meta = { threads: +t[1], chains: +t[2], ms: +t[3] };
        if (t[0] === 'result') { cur = { strategy: t[1], cost: +t[2], ms: +t[3], items: [] }; suggestions.push(cur); }
        if (t[0] === 'pose' && cur) cur.items.push({ ...byId[t[1]], x: +t[2], z: +t[3], rot: +t[4] });
      }
      resolve({ suggestions, ...meta, engine: 'native' });
    });
    p.stdin.end(toText(project, opts.restarts ?? 2, opts.iterScale ?? 1));
  });
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.end();
  if (req.url === '/health') return res.end(JSON.stringify({ ok: true, bin: BIN }));
  if (req.url === '/optimize' && req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    try {
      const data = JSON.parse(body);
      const result = await run({ room: data.room, items: data.items }, data);
      res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(result));
    } catch (e) { res.statusCode = 500; return res.end(JSON.stringify({ error: e.message })); }
  }
  res.statusCode = 404; res.end();
}).listen(PORT, () => console.log(`LayoutLens native bridge on http://localhost:${PORT} using ${BIN}`));

export { toText };
