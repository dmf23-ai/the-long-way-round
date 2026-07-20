/* Simulates mashing "take an even longer way": each round demands
   previous hops + 1, carries forward the avoided edges, and checks
   the engine actually delivers. Usage: node test/longer-way.mjs [from] [to] */

import { resolveEntity, getItemLabels } from '../js/wikidata.js';
import { findPath } from '../js/pathfinder.js';

const [fromQ, toQ] = [process.argv[2] || 'Grateful Dead', process.argv[3] || 'homeschooling'];
const [from, to] = await Promise.all([resolveEntity(fromQ), resolveEntity(toQ)]);
console.log(`${from.label} (${from.id}) → ${to.label} (${to.id})\n`);

const avoidEdges = new Set();
let required = 7;         // the app's floor
let temperature = 0.7;
const BASE_SEED = Number(process.argv[4]) || 20260719; // deterministic by default

for (let click = 0; click < 5; click++) {
  const stretch = Math.max(0, required - 7);
  const t0 = Date.now();
  // mirror the app: one retry with a fresh seed if the demand is missed
  let r = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const cast = await findPath(from.id, to.id, {
      seed: (BASE_SEED ^ (click * 7919)) ^ (attempt * 0x55555555),
      temperature: temperature + attempt * 0.2,
      avoidEdges,
      minHops: required,
      maxRounds: 13 + stretch + attempt * 2,
      maxDepthPerSide: 7 + Math.ceil(stretch / 2) + attempt,
      nodeBudget: 720 + stretch * 90 + attempt * 220,
    });
    if (!r || (cast.path && (!r.path || cast.path.hopCount > r.path.hopCount))) r = cast;
    if (r.path && r.path.hopCount >= required) break;
  }
  if (!r.path) { console.log(`  demand ≥${required}: NO PATH`); process.exitCode = 1; break; }
  const labels = await getItemLabels(r.path.nodes);
  const short = r.path.hopCount < required;
  console.log(`  demand ≥${required}: got ${r.path.hopCount} hops ${short ? '✗ SHORT' : '✓'}  (${Date.now() - t0}ms, explored ${r.stats.explored})`);
  console.log(`    ${r.path.nodes.map(id => labels.get(id) || id).join(' → ')}`);
  if (short) process.exitCode = 1;
  for (const k of r.usedEdges) avoidEdges.add(k);
  required = Math.min(12, r.path.hopCount + 1);
  temperature = Math.min(1.6, temperature + 0.2);
  await new Promise(res => setTimeout(res, 1500));
}
