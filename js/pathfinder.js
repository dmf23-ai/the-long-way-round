/* ══════════════════════════════════════════════════════════════
   pathfinder.js — bidirectional stochastic beam search over the
   live Wikidata graph, optimizing interestingness, not distance.

   Both endpoints grow a frontier outward along item→item claims.
   Edge scores = property informativeness + hub damping + degree
   damping + diversity pressure + Gumbel noise (stochastic beam:
   every run samples a fresh near-optimal scenic route). When the
   two frontiers touch, joined paths are re-scored with a length
   shaping term that prefers five-to-eight-hop routes.
   ══════════════════════════════════════════════════════════════ */

import { getEntities, extractLinks, getItemLabels, getIncomingLinks, cappedInDegree } from './wikidata.js';
import {
  propWeight, hubPenalty, degreePenalty, shapeBonus, classPenalty,
  gumbel, makeRng, PRUNE, STEP_COST, isForbiddenStation, BROAD_IN_DEGREE,
} from './scoring.js';

const edgeKey = (a, p, b) => `${a}|${p}|${b}`;

// session cache for live generality checks: qid -> capped incoming count.
// Counts are capped at BROAD_IN_DEGREE, so entries are verdicts for the
// current threshold; failures are never cached (unknown ≠ safe).
const inDegreeCache = new Map();

function pathNodes(sideOrigin, entry) {
  const nodes = [sideOrigin];
  for (const e of entry.edges) nodes.push(e.to);
  return nodes;
}

/**
 * @param {string} fromId  Q-id of departure
 * @param {string} toId    Q-id of destination
 * @param {object} opts    { seed, temperature, minHops, beamWidth,
 *                           maxRounds, nodeBudget, avoidEdges, onEvent, control }
 * @returns {object|null}  { path, shortest, stats, usedEdges } or null
 */
export async function findPath(fromId, toId, opts = {}) {
  const {
    seed = (Date.now() & 0x7fffffff),
    temperature = 0.6,
    minHops = 7,
    beamWidth = 40,
    maxRounds = 13,
    maxDepthPerSide = 7,
    nodeBudget = 720,
    avoidEdges = new Set(),
    avoidNodes = new Set(),
    onEvent = () => {},
    control = { cancelled: false },
  } = opts;

  const rng = makeRng(seed);
  const origins = [fromId, toId];
  // when a long way is demanded, hops get cheaper so the frontier digs deeper
  const depthBias = Math.min(0.6, Math.max(0, (minHops - 6) * 0.15));

  // per side: best known partial path to each discovered node
  const best = [new Map(), new Map()];
  best[0].set(fromId, { score: 0, hops: 0, edges: [] });
  best[1].set(toId, { score: 0, hops: 0, edges: [] });

  const expanded = [new Set(), new Set()];
  const frontier = [[fromId], [toId]];
  const depth = [0, 0];
  const linksIndex = new Map(); // nodeId -> Set of everything it links to (for triangle checks)

  // endpoints also look backwards along incoming statements: the
  // interesting neighbors of an abstract concept live on OTHER
  // entities' pages, pointing at it. Sampled, endpoints only.
  const incomingPromise = [
    getIncomingLinks(fromId).catch(() => []),
    getIncomingLinks(toId).catch(() => []),
  ];
  // an endpoint's own label, so its first hop is never a same-named twin
  // ("the Amazon river is named after the Amazon company" reads as a bug)
  const normLabel = s => (s || '').trim().toLowerCase();
  const originLabelPromise = getItemLabels([fromId, toId]).catch(() => new Map());
  const meetings = new Set();
  let goodMeetings = 0;
  let fetched = 0;
  let discovered = 2;
  let rounds = 0;

  while (rounds < maxRounds && fetched < nodeBudget && !control.cancelled) {
    // choose the side that still has trail to walk, prefer the shallower one
    let side;
    const can0 = frontier[0].length > 0 && depth[0] < maxDepthPerSide;
    const can1 = frontier[1].length > 0 && depth[1] < maxDepthPerSide;
    if (!can0 && !can1) break;
    if (can0 && can1) side = depth[0] <= depth[1] ? 0 : 1;
    else side = can0 ? 0 : 1;

    const ids = frontier[side].filter(id => !expanded[side].has(id)).slice(0, beamWidth);
    if (!ids.length) { frontier[side] = []; continue; }

    rounds++; depth[side]++;
    onEvent({ type: 'round', round: rounds, side, expanding: ids.length, depth: depth[side] });

    const ents = await getEntities(ids, 'claims');
    if (control.cancelled) break;
    fetched += ids.length;

    // labels for the constellation, fetched in the background — pure delight
    getItemLabels(ids).then(map => { if (!control.cancelled) onEvent({ type: 'labels', map }); }).catch(() => {});

    const levelCandidates = new Map(); // id -> score (for next frontier pick)

    for (const id of ids) {
      expanded[side].add(id);
      const ent = ents.get(id);
      if (!ent) continue;
      const parent = best[side].get(id);
      if (!parent) continue;
      // a forbidden node admitted as a desperate first hop may serve as a
      // meeting point, but never as a springboard — expanding it would let
      // "education" quietly become a through-station after all
      if (isForbiddenStation(id) && id !== origins[0] && id !== origins[1]) continue;

      const links = extractLinks(ent, rng).map(l => ({ ...l, inv: false }));
      const degPen = degreePenalty(links.length) + classPenalty(ent);
      const parentNodes = new Set(pathNodes(origins[side], parent));
      const prevProp = parent.edges.length ? parent.edges[parent.edges.length - 1].prop : null;
      const firstHop = parent.hops === 0;

      if (id === origins[side]) {
        // fold in the sampled incoming neighbors of this endpoint
        let inc = (await incomingPromise[side])
          .filter(({ prop, source }) => propWeight(prop) > PRUNE && source !== id);
        for (let i = inc.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [inc[i], inc[j]] = [inc[j], inc[i]];
        }
        inc = inc.slice(0, 150);
        // drop any incoming neighbor that carries the endpoint's own name — a
        // first hop to a same-named twin ("Amazon named after Amazon") is never
        // the interesting road, and reads as a bug in the tale
        const myLabel = normLabel((await originLabelPromise).get(id));
        if (myLabel) {
          const srcLabels = await getItemLabels(inc.map(x => x.source)).catch(() => new Map());
          inc = inc.filter(({ source }) => normLabel(srcLabels.get(source)) !== myLabel);
        }
        for (const { prop, source } of inc) links.push({ prop, target: source, inv: true });
      }

      linksIndex.set(id, new Set(links.map(l => l.target)));
      const grandparent = parent.edges.length ? parent.edges[parent.edges.length - 1].from : null;
      const gpLinks = grandparent ? linksIndex.get(grandparent) : null;

      for (const { prop, target, inv } of links) {
        if (target === id || parentNodes.has(target)) continue;
        if (avoidNodes.has(target)) continue;
        // triangle check: if the grandparent already links straight to this
        // target, going through the parent is a padded detour — the classic
        // "label → album → band" false start. Routes should be induced paths.
        if (gpLinks && gpLinks.has(target)) continue;
        // ultra-generic classes never serve as through-stations; a sparse
        // endpoint may take one as its very first step, at a stiff price
        const forbidden = isForbiddenStation(target)
          && target !== origins[0] && target !== origins[1];
        if (forbidden && !firstHop) continue;

        let pw = propWeight(prop);
        if (pw <= PRUNE) continue;
        const hubPen = hubPenalty(target);
        // mega-hubs may only be entered through a relation with a story:
        // "named after the United States" earns its keep, "citizen of
        // the United States" never does
        if (hubPen <= -2 && pw <= -1) continue;
        // routes should launch and land on specifics — generic glue is
        // extra dull right next to an endpoint
        if (firstHop && pw < 0) pw *= 1.6;

        let sc = parent.score + pw - STEP_COST + depthBias + degPen + hubPen
          - (forbidden ? 2.5 : 0)
          + (inv ? 0.5 : 0); // someone chose to mention this endpoint — usually specific
        if (prop === prevProp) sc -= 1.3;                       // no taxonomy ladders
        else if (parent.edges.some(e => e.prop === prop)) sc -= 0.5; // keep changing key
        if (avoidEdges.has(edgeKey(id, prop, target)) || avoidEdges.has(edgeKey(target, prop, id))) sc -= 2.5;
        sc += temperature * gumbel(rng);

        const existing = best[side].get(target);
        if (existing && existing.score >= sc) continue;

        best[side].set(target, {
          score: sc,
          hops: parent.hops + 1,
          edges: [...parent.edges, { from: id, prop, to: target, inv }],
        });
        if (!existing) discovered++;
        levelCandidates.set(target, sc);
        onEvent({ type: 'node', id: target, parent: id, side });

        if (best[1 - side].has(target) && !meetings.has(target)) {
          meetings.add(target);
          const totalHops = best[0].get(target).hops + best[1].get(target).hops;
          if (totalHops >= minHops) goodMeetings++;
          onEvent({ type: 'meet', id: target, meetings: meetings.size, hops: totalHops });
        }
      }
    }

    // next frontier for this side: top-scored fresh discoveries (Gumbel already folded in)
    frontier[side] = [...levelCandidates.entries()]
      .filter(([id]) => !expanded[side].has(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, beamWidth)
      .map(([id]) => id);

    onEvent({
      type: 'progress',
      explored: fetched, discovered, meetings: meetings.size,
      frontier: frontier[0].length + frontier[1].length,
    });

    // enough scenic crossings found and both sides reasonably deep? call it
    if (goodMeetings >= 5 && rounds >= 6) break;
    if (meetings.size >= 1 && rounds >= maxRounds - 1) break;
  }

  /* ── join at every crossing, re-score, pick the scenic winner ── */

  const candidates = [];
  // "X is an instance of C, and so is Y" is the dullest pivot in the book —
  // and "X is blue, and so is Y" is barely a pivot at all
  const TAXONOMIC_PIVOT = new Set(['P31', 'P279', 'P17', 'P495', 'P27', 'P462', 'P6364']);
  for (const m of best[0].keys()) {
    if (!best[1].has(m)) continue;
    const a = best[0].get(m);
    const b = best[1].get(m);

    const lastA = a.edges[a.edges.length - 1];
    const lastB = b.edges[b.edges.length - 1];
    if (lastA && lastB && lastA.prop === lastB.prop && TAXONOMIC_PIVOT.has(lastA.prop)) continue;

    const nodesA = pathNodes(fromId, a);          // from … m
    const nodesB = pathNodes(toId, b);            // to … m
    const seen = new Set(nodesA);
    let dup = false;
    for (let i = nodesB.length - 2; i >= 0; i--) {
      if (seen.has(nodesB[i])) { dup = true; break; }
      seen.add(nodesB[i]);
    }
    if (dup) continue;

    const nodes = [...nodesA, ...nodesB.slice(0, -1).reverse()]; // from … m … to
    const hops = [
      // side A is walked with the traversal; an inverted edge flips the claim
      ...a.edges.map(e => ({ prop: e.prop, dir: e.inv ? 'rev' : 'fwd' })),
      // side B is walked against the traversal, so everything flips once more
      ...b.edges.slice().reverse().map(e => ({ prop: e.prop, dir: e.inv ? 'fwd' : 'rev' })),
    ];
    const hopCount = hops.length;
    if (hopCount === 0) continue;

    // duplicate relations across the two halves read as a rut — tax them at the join
    const uniqueProps = new Set(hops.map(h => h.prop)).size;
    const rutPenalty = 0.9 * (hopCount - uniqueProps);
    const score = a.score + b.score + shapeBonus(hopCount) - rutPenalty + 0.25 * temperature * gumbel(rng);
    candidates.push({ nodes, hops, hopCount, score, meetingNode: m });
  }

  if (!candidates.length) {
    return { path: null, shortest: null, stats: { explored: fetched, discovered, meetings: meetings.size, rounds, seed } };
  }

  candidates.sort((x, y) => y.score - x.score);
  const shortest = candidates.slice().sort((x, y) => x.hopCount - y.hopCount)[0];

  // stratified shortlist: floor-meeting candidates get first claim on the
  // enrichment slots, so an all-short shortlist can't happen while a longer
  // road waits at #17
  const qualifiedC = candidates.filter(c => c.hopCount >= minHops);
  const shortC = candidates.filter(c => c.hopCount < minHops);

  /* ── retrieve-then-rerank: judge the finalists by what a reader
     will actually see. Fetch labels AND claims for the top candidates,
     then reject routes with reader-visible defects:
       · duplicate names   — "education → education" is a bug, not a journey
       · chords            — if stop 1 links straight to stop 3, stop 2 is
                             a pointless detour (routes should be induced paths)
       · edition items     — the Czech translation of a book is paperwork;
                             the work itself is the story                    ── */

  const finalists = [...qualifiedC, ...shortC].slice(0, 16);
  const finalistIds = [...new Set(finalists.flatMap(c => c.nodes))];
  let labels = new Map();
  let ents = new Map();
  try {
    [labels, ents] = await Promise.all([
      getItemLabels(finalistIds),
      getEntities(finalistIds, 'claims'),
    ]);
  } catch { /* rerank gracefully degrades to score order */ }

  const linksTo = (aId, bId) => {
    const e = ents.get(aId);
    if (!e || !e.claims) return false;
    for (const statements of Object.values(e.claims)) {
      for (const st of statements) {
        if (st.mainsnak?.datavalue?.value?.id === bId) return true;
      }
    }
    return false;
  };
  const isEdition = (id) => {
    const c = ents.get(id)?.claims;
    if (!c) return false;
    if (c.P629) return true; // edition or translation of
    return (c.P31 || []).some(st => st.mainsnak?.datavalue?.value?.id === 'Q3331189');
  };

  // count reader-visible defects; the route with the fewest wins, so a
  // slightly-flawed real path still beats a pristine dead end
  const defects = (c) => {
    let n = 0;
    const seen = new Set();
    for (const id of c.nodes) {
      const l = (labels.get(id) || id).trim();
      if (/^Q\d+$/.test(l)) n += 3;                       // unnarratable stop
      if (seen.has(l.toLowerCase())) n += 3;              // "education → education"
      seen.add(l.toLowerCase());
    }
    for (let i = 0; i + 2 < c.nodes.length; i++) {
      if (linksTo(c.nodes[i], c.nodes[i + 2]) || linksTo(c.nodes[i + 2], c.nodes[i])) n += 2; // chord
    }
    for (const id of c.nodes.slice(1, -1)) if (isEdition(id)) n += 2;
    return n;
  };

  /* ── generality gate: the live authority. Class nodes (P279) whose
     incoming degree reaches BROAD_IN_DEGREE never serve as through-
     stations — the compiled set answers instantly, and unknown class
     intermediates get a capped live count, in finalist order, under a
     hard query budget. Failures stay unknown (never treated as safe,
     never cached). ── */

  const isClassNode = (id) => !!ents.get(id)?.claims?.P279;
  const knownBroad = (id) =>
    isForbiddenStation(id) || (inDegreeCache.get(id) ?? 0) >= BROAD_IN_DEGREE;

  const unknownClassIds = [];
  {
    const seenIds = new Set();
    for (const c of finalists) {
      for (const id of c.nodes.slice(1, -1)) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        if (isForbiddenStation(id) || inDegreeCache.has(id)) continue;
        if (isClassNode(id)) unknownClassIds.push(id);
      }
    }
  }
  const GATE_QUERY_BUDGET = 12;
  for (let i = 0; i < unknownClassIds.length && i < GATE_QUERY_BUDGET; i += 3) {
    const batch = unknownClassIds.slice(i, Math.min(i + 3, GATE_QUERY_BUDGET));
    await Promise.all(batch.map(async id => {
      const n = await cappedInDegree(id, BROAD_IN_DEGREE);
      if (n != null) inDegreeCache.set(id, n);
    }));
    if (control.cancelled) break;
  }

  /* ── staged selection: broad-free → length floor → fewest defects →
     scenic band. Each stage filters only if it leaves survivors, so the
     worst case degrades to a confessed compromise, never a dead end. ── */

  finalists.forEach(c => {
    c._broad = c.nodes.slice(1, -1).filter(knownBroad);
    c._defects = defects(c);
  });
  const broadFree = finalists.filter(c => c._broad.length === 0);
  const stage1 = broadFree.length ? broadFree : finalists;
  const longEnough = stage1.filter(c => c.hopCount >= minHops);
  const stage2 = longEnough.length ? longEnough : stage1;
  const minDefects = Math.min(...stage2.map(c => c._defects));
  const pool = stage2.filter(c => c._defects === minDefects);

  const band = pool.filter(c => c.hopCount <= minHops + 5);
  const path = (band[0] || pool[0]);

  // alternates: next-best readable routes that are genuinely different
  // roads — and never below the floor the chosen road was held to
  const alternates = [];
  for (const c of pool) {
    if (c === path) continue;
    if (c.hopCount < minHops) continue;
    const pathSet = new Set(path.nodes.slice(1, -1));
    const shared = c.nodes.slice(1, -1).filter(n => pathSet.has(n)).length;
    const inner = Math.max(1, c.nodes.length - 2);
    if (shared / inner > 0.5) continue;
    if (alternates.some(a => {
      const aSet = new Set(a.nodes);
      return c.nodes.filter(n => aSet.has(n)).length / c.nodes.length > 0.6;
    })) continue;
    alternates.push(c);
    if (alternates.length >= 3) break;
  }

  return {
    path,
    alternates,
    labels,
    // broad through-stations the chosen route couldn't avoid (empty when clean):
    // the app recasts with these avoided, then confesses if still stuck
    taintedBroad: path._broad || [],
    shortest: shortest.hopCount < path.hopCount ? shortest : null,
    usedEdges: computeUsedEdges(path),
    stats: { explored: fetched, discovered, meetings: meetings.size, rounds, seed },
  };
}

export function computeUsedEdges(path) {
  const usedEdges = new Set();
  for (let i = 0; i < path.hops.length; i++) {
    usedEdges.add(edgeKey(path.nodes[i], path.hops[i].prop, path.nodes[i + 1]));
  }
  return usedEdges;
}

/** Splice out any cycles created by stitching two legs at a waypoint:
    if a node appears twice, drop everything between its occurrences. */
export function trimCycles(nodes, hops) {
  let changed = true;
  while (changed) {
    changed = false;
    const at = new Map();
    for (let i = 0; i < nodes.length; i++) {
      if (at.has(nodes[i])) {
        const j = at.get(nodes[i]);
        nodes.splice(j + 1, i - j);
        hops.splice(j + 1, i - j - 1);
        hops.splice(j, 1);
        changed = true;
        break;
      }
      at.set(nodes[i], i);
    }
  }
  return { nodes, hops };
}

export { edgeKey };
