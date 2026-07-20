/* ══════════════════════════════════════════════════════════════
   audit-seeds.mjs — resolves the curated seed pool and emits js/seeds.js.

   Runs every name in test/seed-names.mjs through the real resolveEntity
   (the same resolver the app uses), prints a review table, and FAILS
   (nonzero exit) on: unresolved names, duplicate QIDs, or descriptions
   matching the known search traps (family/given name, disambiguation,
   EP/album, video game). On success it writes js/seeds.js with
   pre-resolved {id,label,description} objects, so the dice never has to
   resolve at click time and can never land on a same-named EP.

   Usage: node test/audit-seeds.mjs        (review + write)
          node test/audit-seeds.mjs --check (review only, no write)
   ══════════════════════════════════════════════════════════════ */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveEntity, getEntities } from '../js/wikidata.js';
import { SEED_NAMES } from './seed-names.mjs';

const TRAP = /\bfamily name\b|\bgiven name\b|disambiguation|\bEP\b|\bvideo game\b|\bstudio album\b|\bsingle by\b|Wikimedia (category|list|disambiguation)/i;
const writeOut = !process.argv.includes('--check');

const resolved = [];
const problems = [];
const byId = new Map();

// an entry is either a bare string (resolve + audit against traps) or a
// [displayLabel, 'Qid'] tuple that pins a human-verified entity (bypasses
// the resolver and the trap check — the QID was eyeballed at curation time)
for (const entry of SEED_NAMES) {
  const pinned = Array.isArray(entry);
  const name = pinned ? entry[0] : entry;
  let r = null;
  if (pinned) {
    try {
      const e = (await getEntities([entry[1]], 'labels|descriptions', { languages: 'en|mul' })).get(entry[1]);
      if (e) r = { id: entry[1], label: entry[0], description: e.descriptions?.en?.value || e.descriptions?.mul?.value || '' };
    } catch { /* network */ }
  } else {
    try { r = await resolveEntity(entry); } catch { /* network */ }
  }
  if (!r) { problems.push(`UNRESOLVED: "${name}"${pinned ? ` (pinned ${entry[1]})` : ''}`); console.log(`✗ ${name.padEnd(34)} → (unresolved)`); await pause(); continue; }
  const trap = !pinned && TRAP.test(r.description || '');
  if (trap) problems.push(`TRAP: "${name}" → ${r.id} "${r.label}" (${r.description})`);
  if (byId.has(r.id)) problems.push(`DUP QID: "${name}" and "${byId.get(r.id)}" both → ${r.id} (${r.label})`);
  else byId.set(r.id, name);
  console.log(`${trap ? '✗' : (pinned ? '📌' : '·')} ${name.padEnd(34)} → ${r.id.padEnd(10)} ${r.label}${r.description ? ' — ' + r.description : ''}${trap ? ' ⚠ TRAP' : ''}`);
  resolved.push({ id: r.id, label: r.label, description: r.description || '', _from: name });
  await pause();
}

function pause() { return new Promise(r => setTimeout(r, 120)); }

// dedupe by id, keeping first occurrence (a dup is already flagged as a problem)
const seen = new Set();
const unique = resolved.filter(s => (seen.has(s.id) ? false : (seen.add(s.id), true)));

console.log(`\n${resolved.length} names, ${unique.length} unique QIDs, ${problems.length} problems`);
for (const p of problems) console.log(`  ⚠ ${p}`);

if (problems.length) {
  console.log('\n✗ AUDIT FAILED — fix test/seed-names.mjs before regenerating js/seeds.js');
  process.exitCode = 1;
  if (writeOut) { console.log('  (not writing js/seeds.js while problems remain)'); }
  process.exit();
}

if (!writeOut) { console.log('\n✓ audit clean (--check: not writing)'); process.exit(0); }

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\n\r]/g, ' ');
const stamp = new Date().toISOString().slice(0, 10);
const lines = unique.map(s => `  { id: '${s.id}', label: '${esc(s.label)}', description: '${esc(s.description)}' },`);
const out = `/* ══════════════════════════════════════════════════════════════
   seeds.js — GENERATED ${stamp} by test/audit-seeds.mjs, do not edit by hand.

   The "Surprise me" pool: ${unique.length} pre-resolved entities. Shipping
   QIDs (not bare strings) means the dice locks the exact intended entity
   instantly — no resolve-time latency, no same-named-EP surprises. Edit
   test/seed-names.mjs and re-run the audit to change the pool.
   ══════════════════════════════════════════════════════════════ */

export const SEEDS = [
${lines.join('\n')}
];
`;
const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'seeds.js');
writeFileSync(dest, out);
console.log(`\n✓ wrote ${dest} (${unique.length} seeds)`);
