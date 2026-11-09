// Engine facade. The UI only talks to this interface, so the in-browser
// implementation (LocalEngine) can be swapped for the native C++/OpenMP/CUDA
// server (RemoteEngine, see engine/cpp) without touching UI code.
//
// Wire format (JSON) — identical for both engines:
//   project = { room: {width,length,height,doors[],windows[]}, items: [{id,type,x,z,rot,w,d,h,locked}] }

import { evaluate } from './evaluate.js';
import { STRATEGIES, legalize } from './optimizer.js';

export class LocalEngine {
  constructor() {
    this.name = 'Browser (Web Workers)';
    this.threads = Math.max(2, Math.min(8, navigator.hardwareConcurrency || 4));
  }
  analyze(project) { return evaluate(project); }

  /** Runs strategies x restarts SA chains in parallel workers; resolves best per strategy. */
  optimize(project, { strategies = Object.keys(STRATEGIES), restarts = 2, iterations } = {}, onProgress) {
    const jobs = [];
    strategies.forEach((s) => { for (let r = 0; r < restarts; r++) jobs.push({ strategy: s, seed: 1 + r * 7919 + Math.floor(Math.random() * 1e6) }); });
    const progress = new Array(jobs.length).fill(0);
    const results = [];
    const plain = JSON.parse(JSON.stringify({ room: project.room, items: project.items, iterations }));
    const t0 = performance.now();
    return new Promise((resolve, reject) => {
      let next = 0, done = 0;
      const workers = [];
      const launch = (w) => {
        if (next >= jobs.length) { w.terminate(); return; }
        const id = next++;
        w.postMessage({ job: id, project: plain, ...jobs[id] });
      };
      for (let i = 0; i < Math.min(this.threads, jobs.length); i++) {
        const w = new Worker(new URL('./optimizer.worker.js', import.meta.url), { type: 'module' });
        workers.push(w);
        w.onerror = (e) => { workers.forEach((x) => x.terminate()); reject(e); };
        w.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'progress') {
            progress[m.job] = m.progress;
            onProgress?.(progress.reduce((a, b) => a + b, 0) / jobs.length);
            return;
          }
          progress[m.job] = 1; results.push(m); done++;
          onProgress?.(progress.reduce((a, b) => a + b, 0) / jobs.length);
          if (done === jobs.length) {
            const best = {};
            for (const r of results) if (!best[r.strategy] || r.cost < best[r.strategy].cost) best[r.strategy] = r;
            const out = strategies.filter((s) => best[s]).map((s) => {
              const report = evaluate({ room: project.room, items: best[s].items });
              return { strategy: s, ...STRATEGIES[s], items: best[s].items, cost: best[s].cost, report };
            });
            resolve({ suggestions: out, ms: performance.now() - t0, chains: jobs.length, threads: workers.length });
          } else launch(w);
        };
        launch(w);
      }
    });
  }
}

export class RemoteEngine {
  constructor(url = 'http://localhost:8787') { this.url = url; this.name = `Native engine @ ${url}`; }
  async ping() { const r = await fetch(`${this.url}/health`); return r.ok; }
  analyze(project) { return evaluate(project); } // full report (paths, maps) stays client-side for now
  async optimize(project, opts = {}, onProgress) {
    onProgress?.(0.05);
    const r = await fetch(`${this.url}/optimize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: project.room, items: project.items, ...opts }),
    });
    if (!r.ok) throw new Error(`Engine error ${r.status}`);
    const data = await r.json();
    onProgress?.(1);
    data.suggestions = data.suggestions.map((s) => {
      const items = legalize(project.room, s.items); // the C++ port has no legalisation pass yet
      return { ...STRATEGIES[s.strategy], ...s, items, report: evaluate({ room: project.room, items }) };
    });
    return data;
  }
}
