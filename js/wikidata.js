/* ══════════════════════════════════════════════════════════════
   wikidata.js — thin, batched, cached client for the live
   Wikidata API (anonymous CORS via origin=*).
   ══════════════════════════════════════════════════════════════ */

const API = 'https://www.wikidata.org/w/api.php';

// browsers send their own User-Agent (and adding one would trigger CORS
// preflights); under Node we must identify ourselves or get 429s
const IS_NODE = typeof window === 'undefined';
const NODE_HEADERS = IS_NODE
  ? { 'User-Agent': 'TheLongWayRound/1.0 (https://github.com/dmf23; scenic-route demo)' }
  : undefined;

async function politeFetch(url, opts = {}, tries = 4) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...opts, headers: { ...(NODE_HEADERS || {}), ...(opts.headers || {}) } });
    if (res.status === 429 && attempt < tries) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || (1500 * (attempt + 1));
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    return res;
  }
}

async function apiGet(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', origin: '*', ...params });
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`Wikidata answered ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Wikidata API error: ${data.error.info || data.error.code}`);
  return data;
}

/* ---------- entity search (autocomplete) ---------- */

/** Resolve a typed word to its primary entity: skip namespace clutter
    (family names, disambiguations) and prefer the primary topic over
    media works that borrowed its name. Shared by the app and the
    test harness so both judge the same way. */
export async function resolveEntity(query) {
  const norm = s => s.trim().toLowerCase().replace(/^(the|a|an|le|la|les|el|los)\s+/, '');
  const q = norm(query);
  // searching "the French Revolution" surfaces only works titled exactly
  // that; the event itself is labelled "French Revolution". So when the
  // query leads with an article, search both forms and merge.
  const stripped = query.trim().replace(/^(the|a|an|le|la|les|el|los)\s+/i, '');
  const queries = stripped.toLowerCase() !== query.trim().toLowerCase()
    ? [query, stripped] : [query];
  const seen = new Set();
  let results = [];
  await Promise.all(queries.map(async (x, i) => {
    const batch = await searchEntities(x, 7);
    batch.forEach((r, rank) => { r._rank = i * 100 + rank; });
    for (const r of batch) if (!seen.has(r.id)) { seen.add(r.id); results.push(r); }
  }));
  if (!results.length) return null;
  results.sort((a, b) => a._rank - b._rank);

  const dull = /family name|given name|disambiguation|Wikimedia category|research(er)?\b|ORCID/i;
  const candidates = results.filter(r => !dull.test(r.description)).slice(0, 9);
  const pool = candidates.length ? candidates : results.slice(0, 9);

  // Notability by interlinking: the primary topic (band, probe, queen) is
  // described in dozens of Wikipedias; a same-named track or snail in one or
  // two. Counting sitelinks separates "the thing" from things named after it
  // far more reliably than keyword-matching descriptions ever could.
  let counts = new Map();
  try {
    const ents = await getEntities(pool.map(r => r.id), 'sitelinks');
    for (const [id, e] of ents) {
      counts.set(id, Object.keys(e.sitelinks || {}).length);
    }
  } catch { /* fall back to search order */ }

  const exact = pool.filter(r => norm(r.label) === q || norm(r.matchText || '') === q);
  const ranked = (exact.length ? exact : pool).slice();
  ranked.sort((a, b) => {
    const ca = counts.get(a.id) ?? 0, cb = counts.get(b.id) ?? 0;
    if (cb !== ca) return cb - ca;         // most-linked wins
    return a._rank - b._rank;              // else keep search order
  });
  return ranked[0];
}

export async function searchEntities(query, limit = 8) {
  if (!query || !query.trim()) return [];
  const data = await apiGet({
    action: 'wbsearchentities',
    search: query.trim(),
    language: 'en',
    uselang: 'en',
    type: 'item',
    limit: String(limit),
  });
  return (data.search || []).map(s => ({
    id: s.id,
    label: s.label || s.id,
    description: s.description || '',
    matchText: s.match?.text || s.label || s.id,
  }));
}

/* ---------- batched entity fetch with per-props cache ---------- */

const cache = new Map(); // `${props}:${id}` -> entity (or null for missing)

/**
 * Fetch entities in batches of 50 with modest parallelism.
 * @returns Map id -> entity object (missing ids are absent)
 */
export async function getEntities(ids, props = 'claims', extraParams = {}) {
  const key = id => props + ':' + id;
  const unique = [...new Set(ids)];
  const need = unique.filter(id => !cache.has(key(id)));

  const batches = [];
  for (let i = 0; i < need.length; i += 50) batches.push(need.slice(i, i + 50));

  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, batches.length) }, async () => {
    while (cursor < batches.length) {
      const batch = batches[cursor++];
      let data;
      try {
        data = await apiGet({ action: 'wbgetentities', ids: batch.join('|'), props, ...extraParams });
      } catch (e) {
        // one retry after a breath — Wikidata occasionally hiccups under load
        await new Promise(r => setTimeout(r, 900));
        data = await apiGet({ action: 'wbgetentities', ids: batch.join('|'), props, ...extraParams });
      }
      for (const [id, ent] of Object.entries(data.entities || {})) {
        cache.set(key(id), ent.missing !== undefined ? null : ent);
      }
      // requested ids that came back under a redirect target: mark as missing-ish
      for (const id of batch) if (!cache.has(key(id))) cache.set(key(id), null);
    }
  });
  await Promise.all(workers);

  const out = new Map();
  for (const id of unique) {
    const ent = cache.get(key(id));
    if (ent) out.set(id, ent);
  }
  return out;
}

/* ---------- incoming edges (SPARQL, endpoints only) ----------
   An abstract concept's interesting neighbors — the people who
   practiced it, the books about it — point TOWARD it, on their
   own pages. One sampled query per endpoint lets the search set
   out against the arrows too. */

const SPARQL = 'https://query.wikidata.org/sparql';

export async function getIncomingLinks(qid, cap = 900) {
  // exclude the graph's paperwork up front: editions/translations,
  // scholarly-article spam, and Wikimedia plumbing
  const q = `SELECT ?s ?p WHERE {
    ?s ?p wd:${qid} .
    FILTER(STRSTARTS(STR(?p), "http://www.wikidata.org/prop/direct/"))
    FILTER(STRSTARTS(STR(?s), "http://www.wikidata.org/entity/Q"))
    FILTER NOT EXISTS { VALUES ?junk { wd:Q3331189 wd:Q13442814 wd:Q4167836 wd:Q4167410 wd:Q13406463 wd:Q30612 } ?s wdt:P31 ?junk }
  } LIMIT ${cap}`;
  const url = SPARQL + '?query=' + encodeURIComponent(q) + '&format=json';
  const res = await politeFetch(url, { headers: { Accept: 'application/sparql-results+json' } });
  if (!res.ok) throw new Error(`WDQS answered ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const b of data.results?.bindings || []) {
    const s = b.s.value.split('/').pop();
    const p = b.p.value.split('/').pop();
    if (!/^Q\d+$/.test(s) || !/^P\d+$/.test(p)) continue;
    out.push({ prop: p, source: s });
  }
  return out;
}

/* ---------- claim helpers ---------- */

/**
 * Extract item→item links from an entity's claims.
 * Returns [{ prop, target }], skipping deprecated ranks and non-item values.
 * Fan-out per property is capped (randomly sampled) to keep hubs polite.
 */
export function extractLinks(entity, rng = Math.random, perPropCap = 24, totalCap = 110) {
  const links = [];
  if (!entity || !entity.claims) return links;
  for (const [prop, statements] of Object.entries(entity.claims)) {
    let targets = [];
    for (const st of statements) {
      if (st.rank === 'deprecated') continue;
      const snak = st.mainsnak;
      if (!snak || snak.snaktype !== 'value') continue;
      if (snak.datatype !== 'wikibase-item') continue;
      const v = snak.datavalue && snak.datavalue.value;
      if (!v || !v.id) continue;
      targets.push(v.id);
    }
    if (targets.length > perPropCap) {
      // reservoir-ish shuffle sample so giant properties don't dominate
      for (let i = targets.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [targets[i], targets[j]] = [targets[j], targets[i]];
      }
      targets = targets.slice(0, perPropCap);
    }
    for (const t of targets) links.push({ prop, target: t });
  }
  if (links.length > totalCap) {
    for (let i = links.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [links[i], links[j]] = [links[j], links[i]];
    }
    links.length = totalCap;
  }
  return links;
}

/** First value of a property on an entity (e.g. P18 image filename). */
export function firstClaimValue(entity, prop) {
  const st = entity && entity.claims && entity.claims[prop];
  if (!st || !st.length) return null;
  for (const s of st) {
    if (s.rank === 'deprecated') continue;
    const snak = s.mainsnak;
    if (snak && snak.snaktype === 'value' && snak.datavalue) {
      const v = snak.datavalue.value;
      return v && v.id ? v.id : v;
    }
  }
  return null;
}

/** All item-values of a property on an entity (e.g. P31 types). */
export function claimItemValues(entity, prop) {
  const out = [];
  const st = entity && entity.claims && entity.claims[prop];
  if (!st) return out;
  for (const s of st) {
    if (s.rank === 'deprecated') continue;
    const snak = s.mainsnak;
    if (snak && snak.snaktype === 'value' && snak.datatype === 'wikibase-item' && snak.datavalue?.value?.id) {
      out.push(snak.datavalue.value.id);
    }
  }
  return out;
}

/* ---------- presentation helpers ---------- */

export function commonsImageUrl(filename, width = 640) {
  if (!filename) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(filename).replace(/ /g, '_'))}?width=${width}`;
}

export function entityUrl(id) {
  return `https://www.wikidata.org/wiki/${id}`;
}

/** Rich "cards" for the final path: label, description, image, wiki link. */
export async function getCards(ids) {
  const ents = await getEntities(ids, 'labels|descriptions|claims|sitelinks', {
    languages: 'en|mul',
    sitefilter: 'enwiki',
  });
  const cards = new Map();
  for (const id of ids) {
    const e = ents.get(id);
    if (!e) { cards.set(id, { id, label: id, description: '', image: null, url: entityUrl(id) }); continue; }
    const label = e.labels?.en?.value || e.labels?.mul?.value || id;
    const description = e.descriptions?.en?.value || e.descriptions?.mul?.value || '';
    const image = commonsImageUrl(firstClaimValue(e, 'P18'), 640);
    const enwiki = e.sitelinks?.enwiki?.title;
    const url = enwiki
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(enwiki.replace(/ /g, '_'))}`
      : entityUrl(id);
    cards.set(id, { id, label, description, image, url, types: claimItemValues(e, 'P31') });
  }
  return cards;
}

/** Labels for a set of property ids (P…), for narration fallbacks. */
export async function getPropertyLabels(propIds) {
  const unique = [...new Set(propIds)];
  if (!unique.length) return new Map();
  const ents = await getEntities(unique, 'labels', { languages: 'en|mul' });
  const out = new Map();
  for (const p of unique) {
    const e = ents.get(p);
    out.set(p, e?.labels?.en?.value || e?.labels?.mul?.value || p);
  }
  return out;
}

/** The most interesting neighbors of a node, for in-panel graph exploration.
    Blends outgoing claims with a sample of incoming statements, ranks by the
    same property-informativeness prior the pathfinder uses, and returns
    labelled, deduplicated, direction-aware links. */
export async function getInterestingNeighbors(id, propWeight, PRUNE, limit = 7) {
  const [ents, incoming] = await Promise.all([
    getEntities([id], 'claims'),
    getIncomingLinks(id, 400).catch(() => []),
  ]);
  const ent = ents.get(id);
  const raw = [];
  if (ent?.claims) {
    for (const [prop, statements] of Object.entries(ent.claims)) {
      const w = propWeight(prop);
      if (w <= PRUNE) continue;
      for (const st of statements) {
        if (st.rank === 'deprecated') continue;
        const snak = st.mainsnak;
        if (snak?.snaktype === 'value' && snak.datatype === 'wikibase-item' && snak.datavalue?.value?.id) {
          raw.push({ prop, target: snak.datavalue.value.id, dir: 'fwd', w });
        }
      }
    }
  }
  for (const { prop, source } of incoming) {
    const w = propWeight(prop);
    if (w <= PRUNE) continue;
    raw.push({ prop, target: source, dir: 'rev', w: w + 0.4 });
  }
  // dedup by target, keep the highest-weight relation, drop self
  const best = new Map();
  for (const r of raw) {
    if (r.target === id) continue;
    const cur = best.get(r.target);
    if (!cur || r.w > cur.w) best.set(r.target, r);
  }
  const ranked = [...best.values()].sort((a, b) => b.w - a.w).slice(0, limit * 2);
  const [labels, propLabels] = await Promise.all([
    getItemLabels(ranked.map(r => r.target)),
    getPropertyLabels(ranked.map(r => r.prop)),
  ]);
  return ranked
    .filter(r => labels.has(r.target) && !/^Q\d+$/.test(labels.get(r.target)))
    .slice(0, limit)
    .map(r => ({ ...r, label: labels.get(r.target), rel: propLabels.get(r.prop) || r.prop }));
}

/** Labels for a set of item ids (frontier labels for the live constellation). */
export async function getItemLabels(ids) {
  const ents = await getEntities(ids, 'labels', { languages: 'en|mul' });
  const out = new Map();
  for (const [id, e] of ents) out.set(id, e?.labels?.en?.value || e?.labels?.mul?.value || id);
  return out;
}
