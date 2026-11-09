import { anneal } from './optimizer.js';

self.onmessage = (e) => {
  const { job, project, strategy, seed } = e.data;
  const t0 = performance.now();
  const res = anneal(project, strategy, seed, (p, c) => self.postMessage({ job, type: 'progress', progress: p, cost: c }));
  self.postMessage({ job, type: 'done', strategy, seed, items: res.items, cost: res.cost, ms: performance.now() - t0 });
};
