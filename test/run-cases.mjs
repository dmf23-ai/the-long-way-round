/* ══════════════════════════════════════════════════════════════
   run-cases.mjs — headless quality harness for the pathfinder.

   Runs the real engine (same modules the browser uses) across a
   spread of endpoint types and flags reader-visible smells:
     · hub traversals      · duplicate names       · chords
     · edition items       · non-English labels    · fallback phrasing
   Usage:  node test/run-cases.mjs [caseIndex] [seed]
   ══════════════════════════════════════════════════════════════ */

import { resolveEntity, getCards, getPropertyLabels, getEntities, cappedInDegree } from '../js/wikidata.js';
import { findPath } from '../js/pathfinder.js';
import { hopClause, TEMPLATES } from '../js/narrate.js';
import { PROP_META, propLabel, HUB_PENALTY, makeRng, isForbiddenStation, BROAD_IN_DEGREE } from '../js/scoring.js';

const FLOOR = 7; // the minimum journey length the app now enforces

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

// Three tiers, mirroring how the engine itself treats issues:
//   FAIL — the promises. Two hold on EVERY route offered (chosen or alternate),
//          because they are David's explicit revision contracts: the journey-
//          length floor (SHORT) and the generality gate (TOO-GENERAL). On the
//          CHOSEN path the older reader-visible guarantees are also FAILs —
//          duplicate names, non-English labels, edition items, and HUB (the
//          hub-entry rule is a hard guarantee, so a mega-hub through-station
//          means it was bypassed).
//   WARN — blemishes the engine SOFT-MINIMIZES rather than forbids: CHORDs
//          (defects() counts them and picks least-bad — "a slightly-flawed real
//          path beats a pristine dead end"). At the 7-hop floor the least-
//          defective route occasionally carries one. Printed, not a failure.
//   NOTE — cosmetic: a missing narration template, a boring connective hop, and
//          any of the older cosmetic defects when they land on an ALTERNATE —
//          secondary "other roads scouted" aren't held to chosen-path polish.
async function judgePath(path, cards, propLabels, { liveGate = true, isAlt = false } = {}) {
  const fail = [], warn = [], note = [];
  const names = path.nodes.map(id => cards.get(id)?.label || id);
  // a cosmetic reader-defect: a hard FAIL on the chosen path, a NOTE on an alternate
  const cosmetic = isAlt ? note : fail;

  // below the journey-length floor — a universal contract (fails alternates too)
  if (path.hopCount < FLOOR) fail.push(`SHORT: only ${path.hopCount} steps (< ${FLOOR})`);

  // duplicate names
  const seen = new Set();
  for (const n of names) {
    const k = n.toLowerCase();
    if (seen.has(k)) cosmetic.push(`DUP-NAME: "${n}" appears twice`);
    seen.add(k);
  }
  // hub intermediates — a hard guarantee on the chosen path, tolerated on alts
  for (const id of path.nodes.slice(1, -1)) {
    const p = HUB_PENALTY.get(id);
    if (p !== undefined && p <= -2) cosmetic.push(`HUB: ${cards.get(id)?.label || id} (${id}) as through-station`);
  }
  // too-general through-stations: the generality gate — a universal contract.
  // The compiled set answers instantly; the chosen path also gets a live
  // in-degree check on any class node it missed (alternates skip it for cost).
  const midEnts = await getEntities(path.nodes.slice(1, -1), 'claims');
  for (const id of path.nodes.slice(1, -1)) {
    if (isForbiddenStation(id)) { fail.push(`TOO-GENERAL: ${cards.get(id)?.label || id} (${id}) is a known broad node`); continue; }
    if (!liveGate) continue;
    if (!midEnts.get(id)?.claims?.P279) continue; // not a class node — exempt
    const deg = await cappedInDegree(id, BROAD_IN_DEGREE);
    if (deg != null && deg >= BROAD_IN_DEGREE) {
      fail.push(`TOO-GENERAL: ${cards.get(id)?.label || id} (${id}) in-degree ≥${BROAD_IN_DEGREE}`);
    }
  }
  // non-English labels
  for (const n of names) if (nonEnglishish(n)) cosmetic.push(`NON-EN: "${n}"`);
  // editions
  const ents = await getEntities(path.nodes, 'claims');
  for (const id of path.nodes.slice(1, -1)) {
    const c = ents.get(id)?.claims;
    if (c?.P629 || (c?.P31 || []).some(st => st.mainsnak?.datavalue?.value?.id === 'Q3331189')) {
      cosmetic.push(`EDITION: ${cards.get(id)?.label || id}`);
    }
  }
  // chords — soft by design (defect-minimized, not forbidden)
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
      const msg = `CHORD: ${names[i]} links straight to ${names[i + 2]} (skipping ${names[i + 1]})`;
      (isAlt ? note : warn).push(msg);
    }
  }
  // narration/scoring niceties — cosmetic (chosen path only)
  if (!isAlt) {
    for (const h of path.hops) {
      if (!TEMPLATES[h.prop]) note.push(`FALLBACK-TEMPLATE: ${h.prop} (${propLabel(h.prop, propLabels.get(h.prop))})`);
      const w = PROP_META[h.prop]?.w;
      if (w !== undefined && w <= -2) note.push(`BORING-HOP: ${h.prop} (${propLabel(h.prop)}) w=${w}`);
    }
  }
  return { fail, warn, note };
}

// mirror the app's two-attempt policy: cast at the floor, and if the first
// cast is short or leans on a broad node, recast wider with those avoided
async function castLikeApp(fromId, toId, seed) {
  const minHops = FLOOR;
  const quality = (r) => !r?.path ? -1
    : (r.taintedBroad?.length ? 0 : 2) + (r.path.hopCount >= minHops ? 1 : 0);
  let result = null;
  const broadAvoid = new Set();
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await findPath(fromId, toId, {
      seed: seed ^ (attempt * 0x55555555),
      temperature: 0.6 + attempt * 0.2,
      avoidNodes: broadAvoid,
      minHops,
      maxRounds: 13 + attempt * 2,
      maxDepthPerSide: 7 + attempt,
      nodeBudget: 720 + attempt * 220,
    });
    if (!result || quality(r) > quality(result)
      || (quality(r) === quality(result) && r.path && result.path && r.path.hopCount > result.path.hopCount)) result = r;
    if (r.path && r.path.hopCount >= minHops && !(r.taintedBroad || []).length) break;
    for (const q of r.taintedBroad || []) broadAvoid.add(q);
  }
  return result;
}

async function runCase([fromQ, toQ], seed) {
  const t0 = Date.now();
  const [from, to] = await Promise.all([resolveEntity(fromQ), resolveEntity(toQ)]);
  if (!from || !to) { console.log(`  !! could not resolve ${fromQ} / ${toQ}`); return 1; }
  console.log(`  ${from.label} (${from.id}: ${from.description}) → ${to.label} (${to.id}: ${to.description})`);

  const result = await castLikeApp(from.id, to.id, seed);
  if (!result.path) { console.log(`  !! NO PATH (explored ${result.stats.explored})`); return 1; }

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
  const { fail, warn, note } = await judgePath(path, cards, extraPropLabels);
  console.log(`  steps=${path.hopCount} explored=${stats.explored} meetings=${stats.meetings} alts=${result.alternates.length} ${Date.now() - t0}ms seed=${seed}`);

  // alternates are offered to the reader too — held to the FAIL bar (minus HUB);
  // their hub/chord roughness is noted, not failed. Skip the live gate for cost.
  for (let a = 0; a < (result.alternates || []).length; a++) {
    const alt = result.alternates[a];
    const altCards = await getCards(alt.nodes);
    const { fail: altFail, note: altNote } = await judgePath(alt, altCards, extraPropLabels, { liveGate: false, isAlt: true });
    for (const w of altFail) fail.push(`ALT${a + 1}: ${w}`);
    for (const w of altNote) note.push(`ALT${a + 1}: ${w}`);
  }

  for (const w of fail) console.log(`  ✗ ${w}`);            // fails the run
  for (const w of warn) console.log(`  ⚠ ${w}`);            // notable, tolerated
  for (const w of note) console.log(`  · ${w}`);            // cosmetic
  if (!fail.length) console.log(`  ✓ clean${warn.length || note.length ? ` (${warn.length} warn, ${note.length} note)` : ''}`);
  return fail.length;                                       // only FAIL-tier smells fail the run
}

const list = onlyIdx !== null ? [CASES[onlyIdx]] : CASES;
let totalWarns = 0;
for (let i = 0; i < list.length; i++) {
  const seed = seedArg ?? (1000003 * (onlyIdx ?? i) + 7777);
  console.log(`\n═══ CASE ${onlyIdx ?? i}: ${list[i][0]} → ${list[i][1]} ═══`);
  try {
    totalWarns += await runCase(list[i], seed);
  } catch (e) {
    console.log(`  !! ERROR: ${e.message}`);
    totalWarns += 1;
  }
  if (list.length > 1) await new Promise(r => setTimeout(r, 2500)); // be a polite guest
}
console.log(`\n═══ ${totalWarns === 0 ? '✓ ALL CLEAN' : `✗ ${totalWarns} warning(s)`} ═══`);
process.exitCode = totalWarns === 0 ? 0 : 1;
