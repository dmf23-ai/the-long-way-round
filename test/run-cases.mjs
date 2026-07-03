/* ══════════════════════════════════════════════════════════════
   run-cases.mjs — headless quality harness for the pathfinder.

   Runs the real engine (same modules the browser uses) across a
   spread of endpoint types and flags reader-visible smells:
     · hub traversals      · duplicate names       · chords
     · edition items       · non-English labels    · fallback phrasing
   Usage:  node test/run-cases.mjs [caseIndex] [seed]
   ══════════════════════════════════════════════════════════════ */

import { resolveEntity, getCards, getPropertyLabels, getEntities } from '../js/wikidata.js';
import { findPath } from '../js/pathfinder.js';
import { hopClause, TEMPLATES } from '../js/narrate.js';
import { PROP_META, propLabel, HUB_PENALTY, makeRng } from '../js/scoring.js';

const CASES = [
  ['Grateful Dead Records', 'homeschooling'],   // org → abstract concept (the user's case)
  ['Medicaid', 'banjo'],                        // program → object (the canonical demo)
  ['Marie Curie', 'Genghis Khan'],              // person → person, centuries apart
  ['Alan Turing', 'origami'],                   // person → craft concept
  ['Mount Everest', 'sushi'],                   // place → food
  ['NASA', 'platypus'],                         // org → animal
  ['French Revolution', 'bubble wrap'],         // event → mundane object
  ['penicillin', 'The Starry Night'],           // substance → artwork
  ['Nintendo', 'Cleopatra'],                    // modern company → ancient ruler
  ['jazz', 'democracy'],                        // abstract → abstract
  ['croissant', 'black hole'],                  // food → astrophysics
  ['Trans-Siberian Railway', 'jellyfish'],      // infrastructure → sea creature
  ['Beyoncé', 'the Great Wall of China'],       // pop star → ancient wonder
  ['coffee', 'the French Revolution'],          // beverage → event
  ['William Shakespeare', 'the Internet'],      // playwright → technology
  ['chess', 'the Moon'],                        // game → celestial body
  ['Vincent van Gogh', 'bitcoin'],              // painter → cryptocurrency
  ['the Amazon River', 'The Beatles'],          // river → band
];

const onlyIdx = process.argv[2] !== undefined ? Number(process.argv[2]) : null;
const seedArg = process.argv[3] !== undefined ? Number(process.argv[3]) : null;

function nonEnglishish(label) {
  const chars = [...label];
  const weird = chars.filter(ch => ch.codePointAt(0) > 0x24F).length;
  return chars.length > 4 && weird / chars.length > 0.25;
}

async function judgePath(path, cards, propLabels) {
  const warns = [];
  const names = path.nodes.map(id => cards.get(id)?.label || id);

  // duplicate names
  const seen = new Set();
  for (const n of names) {
    const k = n.toLowerCase();
    if (seen.has(k)) warns.push(`DUP-NAME: "${n}" appears twice`);
    seen.add(k);
  }
  // hub intermediates
  for (const id of path.nodes.slice(1, -1)) {
    const p = HUB_PENALTY.get(id);
    if (p !== undefined && p <= -2) warns.push(`HUB: ${cards.get(id)?.label || id} (${id}) as through-station`);
  }
  // non-English labels
  for (const n of names) if (nonEnglishish(n)) warns.push(`NON-EN: "${n}"`);
  // editions
  const ents = await getEntities(path.nodes, 'claims');
  for (const id of path.nodes.slice(1, -1)) {
    const c = ents.get(id)?.claims;
    if (c?.P629 || (c?.P31 || []).some(st => st.mainsnak?.datavalue?.value?.id === 'Q3331189')) {
      warns.push(`EDITION: ${cards.get(id)?.label || id}`);
    }
  }
  // chords
  const linksTo = (aId, bId) => {
    const e = ents.get(aId);
    if (!e?.claims) return false;
    for (const sts of Object.values(e.claims)) {
      for (const st of sts) if (st.mainsnak?.datavalue?.value?.id === bId) return true;
    }
    return false;
  };
  for (let i = 0; i + 2 < path.nodes.length; i++) {
    if (linksTo(path.nodes[i], path.nodes[i + 2]) || linksTo(path.nodes[i + 2], path.nodes[i])) {
      warns.push(`CHORD: ${names[i]} links straight to ${names[i + 2]} (skipping ${names[i + 1]})`);
    }
  }
  // fallback phrasing + very boring hops
  for (const h of path.hops) {
    if (!TEMPLATES[h.prop]) warns.push(`FALLBACK-TEMPLATE: ${h.prop} (${propLabel(h.prop, propLabels.get(h.prop))})`);
    const w = PROP_META[h.prop]?.w;
    if (w !== undefined && w <= -2) warns.push(`BORING-HOP: ${h.prop} (${propLabel(h.prop)}) w=${w}`);
  }
  return warns;
}

async function runCase([fromQ, toQ], seed) {
  const t0 = Date.now();
  const [from, to] = await Promise.all([resolveEntity(fromQ), resolveEntity(toQ)]);
  if (!from || !to) { console.log(`  !! could not resolve ${fromQ} / ${toQ}`); return; }
  console.log(`  ${from.label} (${from.id}: ${from.description}) → ${to.label} (${to.id}: ${to.description})`);

  const result = await findPath(from.id, to.id, { seed, temperature: 0.6 });
  if (!result.path) { console.log(`  !! NO PATH (explored ${result.stats.explored})`); return; }

  const { path, stats } = result;
  const unknownProps = [...new Set(path.hops.map(h => h.prop))].filter(p => !PROP_META[p]);
  const [cards, extraPropLabels] = await Promise.all([getCards(path.nodes), getPropertyLabels(unknownProps)]);
  const rng = makeRng(seed);

  for (let i = 0; i < path.hops.length; i++) {
    const h = path.hops[i];
    const a = cards.get(path.nodes[i])?.label || path.nodes[i];
    const b = cards.get(path.nodes[i + 1])?.label || path.nodes[i + 1];
    const rel = propLabel(h.prop, extraPropLabels.get(h.prop));
    const arrow = h.dir === 'fwd' ? `—[${rel}]→` : `←[${rel}]—`;
    console.log(`    ${i + 1}. ${a} ${arrow} ${b}`);
    console.log(`       "${hopClause(h, a, b, extraPropLabels, rng)}"`);
  }
  const warns = await judgePath(path, cards, extraPropLabels);
  console.log(`  steps=${path.hopCount} explored=${stats.explored} meetings=${stats.meetings} alts=${result.alternates.length} ${Date.now() - t0}ms seed=${seed}`);
  for (const w of warns) console.log(`  ⚠ ${w}`);
  if (!warns.length) console.log('  ✓ clean');
}

const list = onlyIdx !== null ? [CASES[onlyIdx]] : CASES;
for (let i = 0; i < list.length; i++) {
  const seed = seedArg ?? (1000003 * (onlyIdx ?? i) + 7777);
  console.log(`\n═══ CASE ${onlyIdx ?? i}: ${list[i][0]} → ${list[i][1]} ═══`);
  try {
    await runCase(list[i], seed);
  } catch (e) {
    console.log(`  !! ERROR: ${e.message}`);
  }
  if (list.length > 1) await new Promise(r => setTimeout(r, 2500)); // be a polite guest
}
