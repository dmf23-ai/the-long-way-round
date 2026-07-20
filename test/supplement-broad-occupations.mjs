/* ══════════════════════════════════════════════════════════════
   supplement-broad-occupations.mjs — merges occupation- and
   language-class broad-nodes into js/broad-nodes.gen.js.

   The main generator aggregates over per-property statement sets;
   the two properties that make occupations broad (P106, 11M+ rows)
   and languages broad (P103/P407/P1412) either time out on WDQS or
   weren't queried, so the compiled set misses actor/politician/
   composer and Japanese/French/German. This supplements with a
   candidate list of common occupations and major languages, each
   run through the SAME ≥ BROAD_IN_DEGREE ∧ has-P279 gate the runtime
   uses (via cappedInDegree). Candidates that don't reach the
   threshold are dropped — this derives the rule on a seeded set, it
   does not hand-ban topics. Merges into the existing set and rewrites.

   Usage: node test/supplement-broad-occupations.mjs
   ══════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getEntities, getItemLabels, cappedInDegree } from '../js/wikidata.js';
import { BROAD_IN_DEGREE } from '../js/scoring.js';
import { BROAD_NODES } from '../js/broad-nodes.gen.js';

const THRESHOLD = BROAD_IN_DEGREE;

// common occupations — the head of the P106 distribution. Each is still
// verified against the gate; non-qualifiers are silently dropped.
const CANDIDATES = [
  'Q33999',   // actor
  'Q82955',   // politician
  'Q36834',   // composer
  'Q177220',  // singer
  'Q36180',   // writer
  'Q1028181', // painter
  'Q1930187', // journalist
  'Q639669',  // musician
  'Q49757',   // poet
  'Q6625963', // novelist
  'Q2526255', // film director
  'Q937857',  // association football player
  'Q37226',   // teacher
  'Q40348',   // lawyer
  'Q39631',   // physician
  'Q42973',   // architect
  'Q1281618', // sculptor
  'Q33231',   // photographer
  'Q28389',   // screenwriter
  'Q488205',  // singer-songwriter
  'Q3455803', // director
  'Q43845',   // businessperson
  'Q189290',  // military officer
  'Q250867',  // Catholic priest
  'Q4964182', // philosopher
  'Q201788',  // historian
  'Q1622272', // university teacher
  'Q1650915', // researcher
  'Q188094',  // economist
  'Q81096',   // engineer
  'Q170790',  // mathematician
  'Q593644',  // chemist
  'Q169470',  // physicist
  'Q864503',  // biologist
  'Q11063',   // astronomer
  'Q2374149', // botanist
  'Q193391',  // diplomat
  'Q16533',   // judge
  'Q486748',  // pianist
  'Q855091',  // guitarist
  'Q158852',  // conductor
  'Q5716684', // dancer
  'Q214917',  // playwright
  'Q333634',  // translator
  'Q947873',  // television presenter
  'Q2252262', // rapper
  'Q130857',  // DJ
  'Q2405480', // voice actor
  'Q245068',  // comedian
  'Q3282637', // film producer
  'Q3621491', // archaeologist
  'Q212980',  // psychologist
  'Q11631',   // astronaut
  'Q2066131', // athlete
  'Q10833314',// tennis player
  'Q10873124',// chess player
  'Q11338576',// boxer
  'Q2309784', // racing cyclist
  'Q10871364',// baseball player
  'Q3665646', // basketball player
  'Q19204627',// American football player
  'Q3427922', // association football manager
  'Q483501',  // artist
  'Q482980',  // author
  'Q715301',  // scientist
  'Q901',     // scientist (alt)
  'Q2259451', // stage actor
  'Q10800557',// film actor
  'Q10798782',// television actor
  // ── major languages: "X speaks Japanese, and so does Y" is the dullest
  //    pivot on the map; the world points at a language from every speaker ──
  'Q5287',    // Japanese
  'Q150',     // French
  'Q188',     // German
  'Q1321',    // Spanish
  'Q7737',    // Russian
  'Q652',     // Italian
  'Q7850',    // Chinese
  'Q727694',  // Mandarin Chinese
  'Q5146',    // Portuguese
  'Q13955',   // Arabic
  'Q1568',    // Hindi
  'Q397',     // Latin
  'Q7411',    // Dutch
  'Q9176',    // Korean
  'Q809',     // Polish
  'Q256',     // Turkish
  'Q9027',    // Swedish
  'Q9288',    // Hebrew
  'Q11059',   // Sanskrit
  'Q9129',    // Greek
  'Q35497',   // Ancient Greek
  'Q9240',    // Indonesian
  'Q9067',    // Hungarian
  'Q9058',    // Czech
  'Q9610',    // Bengali
  'Q34057',   // Tamil
  'Q8641',    // Ukrainian
  'Q9091',    // Romanian
  'Q9043',    // Norwegian
  'Q9035',    // Danish
  'Q9027',    // Swedish (dup guard, deduped by Set later)
  'Q1412',    // Finnish
  'Q9168',    // Thai
  'Q9199',    // Vietnamese
];

const valid = CANDIDATES.filter(q => /^Q\d+$/.test(q));
const ents = await getEntities(valid, 'claims');
const labels = await getItemLabels(valid);
const verified = new Map();
for (const id of valid) {
  const hasP279 = !!ents.get(id)?.claims?.P279;
  if (!hasP279) { console.log(`  skip ${id} "${labels.get(id) || '?'}" — no P279`); continue; }
  const deg = await cappedInDegree(id, THRESHOLD, 20000);
  await new Promise(r => setTimeout(r, 300));
  if (deg != null && deg >= THRESHOLD) {
    verified.set(id, deg);
    console.log(`  ✓ ${id} "${labels.get(id)}" (≥${deg})`);
  } else {
    console.log(`  drop ${id} "${labels.get(id) || '?'}" — in-degree ${deg}`);
  }
}

// merge with the existing generated set, preserving it
const merged = new Map();
for (const id of BROAD_NODES) merged.set(id, null);
for (const [id, deg] of verified) merged.set(id, deg);

// re-read the existing file to preserve its comments/counts, then rewrite the Set
const genPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'broad-nodes.gen.js');
const existing = readFileSync(genPath, 'utf8');
const allIds = [...merged.keys()];
const allLabels = await getItemLabels(allIds);
// keep prior known counts by parsing existing comments
const priorCount = new Map();
for (const m of existing.matchAll(/'(Q\d+)',\s*\/\/\s*.*?\(≥?(\d+)\)/g)) priorCount.set(m[1], Number(m[2]));

const rows = allIds
  .map(id => ({ id, deg: merged.get(id) ?? priorCount.get(id) ?? 0, label: allLabels.get(id) || '?' }))
  .sort((a, b) => b.deg - a.deg);
const stamp = new Date().toISOString().slice(0, 10);
const lines = rows.map(r => `  '${r.id}', // ${String(r.label).replace(/[\n\r']/g, ' ')} (≥${r.deg})`);
const out = `/* ══════════════════════════════════════════════════════════════
   broad-nodes.gen.js — GENERATED ${stamp}, do not edit by hand.

   Class nodes (P279-bearing) whose capped incoming degree meets or
   exceeds BROAD_IN_DEGREE = ${THRESHOLD} (scoring.js): so much of the
   world points at them that passing through one explains nothing.
   Compiled cache of the generality rule; the pathfinder's rerank
   gate is the live authority for anything missed here. Built by
   test/build-broad-nodes.mjs + test/supplement-broad-occupations.mjs.
   ══════════════════════════════════════════════════════════════ */

export const BROAD_NODES_GENERATED = { date: '${stamp}', threshold: ${THRESHOLD}, count: ${rows.length} };

export const BROAD_NODES = new Set([
${lines.join('\n')}
]);
`;
writeFileSync(genPath, out);
console.log(`\nwrote ${genPath} (${rows.length} nodes total, +${verified.size} verified this run)`);

// sanity: the screenshot offenders present, beloved stops absent
const MUST = { Q33999: 'actor', Q82955: 'politician', Q17172850: 'voice', Q36834: 'composer', Q8341: 'jazz', Q718: 'chess', Q5287: 'Japanese', Q4: 'death(handban)' };
const MUST_NOT = { Q258896: 'banjo', Q51290: 'harmonica', Q79838: 'accordion', Q207832: 'croissant', Q46335: 'typewriter', Q39715: 'lighthouse' };
let ok = true;
for (const [q, n] of Object.entries(MUST)) {
  if (q === 'Q4') continue; // death is a hand-ban in scoring.js, not the compiled set
  if (!merged.has(q)) { console.log(`✗ MISSING expected broad node: ${n} (${q})`); ok = false; }
}
for (const [q, n] of Object.entries(MUST_NOT)) if (merged.has(q)) { console.log(`✗ WRONGLY BANNED: ${n} (${q})`); ok = false; }
console.log(ok ? '✓ sanity checks passed' : '✗ SANITY FAILURES');
process.exitCode = ok ? 0 : 1;
