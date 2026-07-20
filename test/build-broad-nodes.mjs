/* ══════════════════════════════════════════════════════════════
   build-broad-nodes.mjs — compiles js/broad-nodes.gen.js.

   The generality rule (scoring.js): a class node (has P279) with
   ≥ BROAD_IN_DEGREE incoming direct statements is never a
   through-station. This script compiles a high-coverage cache of
   that rule so the browser rarely needs a live check.

   Two phases, so the artifact matches the runtime rule exactly:
     1. DISCOVERY — for each classifying property, GROUP BY value
        with a floor of THRESHOLD/3 (multi-property nodes aren't
        missed by property slicing). Heavy properties that 504
        under a full aggregation (P106 has 11M+ statements) fall
        back to a bounded-sample aggregation: GROUP BY over the
        first 2M statements with a low floor — discovery only, so
        over-discovery is fine and under-discovery is bounded by
        the sample floor. P31/P279 are sampled from the start.
     2. VERIFICATION — every candidate gets the same capped
        total-in-degree query the runtime uses (cappedInDegree)
        plus a P279 check; only total ≥ THRESHOLD ∧ has-P279 pass.
        Sampled counts are lower bounds, so they only shortcut
        verification when they already reach the threshold.

   Usage: node test/build-broad-nodes.mjs
   ══════════════════════════════════════════════════════════════ */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getEntities, getItemLabels, cappedInDegree } from '../js/wikidata.js';
import { BROAD_IN_DEGREE } from '../js/scoring.js';

const THRESHOLD = BROAD_IN_DEGREE;
const DISCOVERY_FLOOR = Math.floor(THRESHOLD / 3);
const SPARQL = 'https://query.wikidata.org/sparql';
const UA = { 'User-Agent': 'TheLongWayRound/1.0 (https://github.com/dmf23; scenic-route demo)' };

// properties whose values classify the things that carry them
const DISCOVERY_PROPS = {
  P106: 'occupation',
  P39: 'position held',
  P509: 'cause of death',
  P1542: 'has effect',
  P1303: 'instrument',
  P136: 'genre',
  P641: 'sport',
  P101: 'field of work',
  P425: 'field of this occupation',
  P2578: 'studies',
  P140: 'religion or worldview',
  P452: 'industry',
  P186: 'made from material',
  P361: 'part of',
};
const MONSTER_PROPS = { P31: 'instance of', P279: 'subclass of' }; // floor = THRESHOLD

async function sparql(query, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(SPARQL + '?query=' + encodeURIComponent(query) + '&format=json',
      { signal: ctrl.signal, headers: { Accept: 'application/sparql-results+json', ...UA } });
    if (!res.ok) throw new Error(`WDQS ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseGroups(data) {
  const out = new Map(); // qid -> count via this property
  for (const b of data.results?.bindings || []) {
    const v = b.v.value.split('/').pop();
    if (/^Q\d+$/.test(v)) out.set(v, Number(b.c.value));
  }
  return out;
}

async function discoverFull(prop, floor) {
  const q = `SELECT ?v (COUNT(?s) AS ?c) WHERE {
    ?s wdt:${prop} ?v .
    FILTER(STRSTARTS(STR(?v), "http://www.wikidata.org/entity/Q"))
  } GROUP BY ?v HAVING(?c >= ${floor}) ORDER BY DESC(?c) LIMIT 3000`;
  return parseGroups(await sparql(q, 65000));
}

// bounded-sample discovery for properties whose full aggregation exceeds
// WDQS's 60 s cap: scan the first `sampleLimit` statements only. Counts
// are lower bounds; verification computes exact totals.
async function discoverSampled(prop, sampleFloor, sampleLimit = 2000000) {
  const q = `SELECT ?v (COUNT(*) AS ?c) WHERE {
    { SELECT ?v WHERE { ?s wdt:${prop} ?v } LIMIT ${sampleLimit} }
    FILTER(STRSTARTS(STR(?v), "http://www.wikidata.org/entity/Q"))
  } GROUP BY ?v HAVING(?c >= ${sampleFloor}) ORDER BY DESC(?c) LIMIT 3000`;
  return parseGroups(await sparql(q, 65000));
}

/* ── phase 1: discovery ── */
const candidates = new Map(); // qid -> { maxSingle, exact, props: [] }

function fold(prop, found, exact) {
  for (const [qid, c] of found) {
    const cur = candidates.get(qid) || { maxSingle: 0, props: [] };
    // sampled counts are lower bounds — still valid for the ≥-threshold shortcut
    cur.maxSingle = Math.max(cur.maxSingle, c);
    cur.props.push(`${prop}:${exact ? '' : '≥'}${c}`);
    candidates.set(qid, cur);
  }
}

for (const [prop, l] of Object.entries(DISCOVERY_PROPS)) {
  process.stdout.write(`discovering via ${prop} (${l})… `);
  try {
    const found = await discoverFull(prop, DISCOVERY_FLOOR);
    console.log(`${found.size} candidates (full)`);
    fold(prop, found, true);
  } catch (e) {
    process.stdout.write(`full aggregation failed (${e.message}), sampling… `);
    try {
      const found = await discoverSampled(prop, 400);
      console.log(`${found.size} candidates (sampled)`);
      fold(prop, found, false);
    } catch (e2) {
      console.log(`FAILED (${e2.message}) — continuing, runtime gate covers the gap`);
    }
  }
  await new Promise(r => setTimeout(r, 800));
}
for (const [prop, l] of Object.entries(MONSTER_PROPS)) {
  process.stdout.write(`discovering via ${prop} (${l}, sampled)… `);
  try {
    const found = await discoverSampled(prop, 150);
    console.log(`${found.size} candidates (sampled)`);
    fold(prop, found, false);
  } catch (e) {
    console.log(`FAILED (${e.message}) — continuing, runtime gate covers the gap`);
  }
  await new Promise(r => setTimeout(r, 800));
}
console.log(`\n${candidates.size} distinct candidates discovered`);

/* ── phase 2: verification ── */
const ids = [...candidates.keys()];
const ents = await getEntities(ids, 'claims');
const classy = ids.filter(id => ents.get(id)?.claims?.P279);
console.log(`${classy.length} candidates have P279 (class nodes) — verifying totals…`);

const verified = new Map(); // qid -> total (capped)
let done = 0;
for (const id of classy) {
  const info = candidates.get(id);
  let total;
  if (info.maxSingle >= THRESHOLD) {
    total = info.maxSingle; // a single property already meets the threshold
  } else {
    total = await cappedInDegree(id, THRESHOLD, 20000);
    await new Promise(r => setTimeout(r, 250));
  }
  if (total != null && total >= THRESHOLD) verified.set(id, total);
  if (++done % 50 === 0) console.log(`  …${done}/${classy.length} verified, ${verified.size} broad so far`);
}
console.log(`${verified.size} nodes verified broad (≥ ${THRESHOLD}, class nodes)`);

/* ── emit ── */
const labels = await getItemLabels([...verified.keys()]);
const sorted = [...verified.entries()].sort((a, b) => b[1] - a[1]);
const stamp = new Date().toISOString().slice(0, 10);
const lines = sorted.map(([qid, c]) =>
  `  '${qid}', // ${String(labels.get(qid) || '?').replace(/[\n\r']/g, ' ')} (${c >= THRESHOLD ? '≥' : ''}${c})`);

const out = `/* ══════════════════════════════════════════════════════════════
   broad-nodes.gen.js — GENERATED ${stamp}, do not edit by hand.

   Class nodes (P279-bearing) whose capped incoming degree meets or
   exceeds BROAD_IN_DEGREE = ${THRESHOLD} (scoring.js): so much of the
   world points at them that passing through one explains nothing.
   Compiled cache of the generality rule; the pathfinder's rerank
   gate is the live authority for anything missed here.
   Regenerate with:  node test/build-broad-nodes.mjs
   ══════════════════════════════════════════════════════════════ */

export const BROAD_NODES_GENERATED = { date: '${stamp}', threshold: ${THRESHOLD}, count: ${sorted.length} };

export const BROAD_NODES = new Set([
${lines.join('\n')}
]);
`;

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'broad-nodes.gen.js');
writeFileSync(dest, out);
console.log(`wrote ${dest} (${sorted.length} nodes)`);

/* sanity: the screenshot offenders must be present; beloved stops absent */
const MUST = { Q33999: 'actor', Q82955: 'politician', Q17172850: 'voice', Q36834: 'composer', Q8341: 'jazz', Q718: 'chess' };
const MUST_NOT = { Q258896: 'banjo', Q51290: 'harmonica', Q79838: 'accordion', Q207832: 'croissant', Q46335: 'typewriter', Q39715: 'lighthouse' };
let ok = true;
for (const [q, n] of Object.entries(MUST)) if (!verified.has(q)) { console.log(`✗ MISSING expected broad node: ${n} (${q})`); ok = false; }
for (const [q, n] of Object.entries(MUST_NOT)) if (verified.has(q)) { console.log(`✗ WRONGLY BANNED: ${n} (${q})`); ok = false; }
console.log(ok ? '✓ sanity checks passed' : '✗ SANITY FAILURES — inspect before committing');
process.exitCode = ok ? 0 : 1;
