/* ══════════════════════════════════════════════════════════════
   scoring.js — the interestingness model.

   Shortest paths through a knowledge graph are dull: everything
   is an *instance of* something, in some *country*, in some
   *language*. So edges are scored by a hand-tuned property
   informativeness prior (an IDF-like weight per relation type),
   nodes by hub damping, and paths by diversity pressure.
   Positive = delightful, negative = boring, ≤ PRUNE = never.
   ══════════════════════════════════════════════════════════════ */

export const PRUNE = -3;          // edges at or below this weight are never taken
export const STEP_COST = 1.0;     // per-hop toll: only genuinely interesting edges pay their way
export const DEFAULT_PROP_WEIGHT = 0.35; // unfamiliar relations are mildly promising

/** propId -> { w: weight, label } (label doubles as narration fallback) */
export const PROP_META = {
  /* ── delightful: the stuff of stories ─────────────────────── */
  P138:  { w: 3.0,  label: 'named after' },
  P941:  { w: 3.0,  label: 'inspired by' },
  P1441: { w: 2.8,  label: 'present in work' },
  P737:  { w: 2.6,  label: 'influenced by' },
  P144:  { w: 2.6,  label: 'based on' },
  P825:  { w: 2.6,  label: 'dedicated to' },
  P61:   { w: 2.5,  label: 'discoverer or inventor' },
  P547:  { w: 2.4,  label: 'commemorates' },
  P1877: { w: 2.3,  label: 'after a work by' },
  P4969: { w: 2.2,  label: 'derivative work' },
  P793:  { w: 2.2,  label: 'significant event' },
  P1830: { w: 2.2,  label: 'owner of' },
  P127:  { w: 2.0,  label: 'owned by' },
  P180:  { w: 2.0,  label: 'depicts' },
  P287:  { w: 2.0,  label: 'designed by' },
  P88:   { w: 2.0,  label: 'commissioned by' },
  P1344: { w: 2.0,  label: 'participant in' },
  P800:  { w: 2.0,  label: 'notable work' },
  P184:  { w: 2.0,  label: 'doctoral advisor' },
  P185:  { w: 2.0,  label: 'doctoral student' },
  P1066: { w: 2.0,  label: 'student of' },
  P802:  { w: 2.0,  label: 'student' },
  P1080: { w: 1.9,  label: 'from narrative universe' },
  P170:  { w: 1.8,  label: 'creator' },
  P86:   { w: 1.8,  label: 'composer' },
  P175:  { w: 1.8,  label: 'performer' },
  P84:   { w: 1.8,  label: 'architect' },
  P26:   { w: 1.8,  label: 'spouse' },
  P451:  { w: 1.8,  label: 'partner' },
  P1303: { w: 1.8,  label: 'instrument' },
  P112:  { w: 1.8,  label: 'founded by' },
  P1029: { w: 1.8,  label: 'crew member' },
  P676:  { w: 1.8,  label: 'lyricist' },
  P921:  { w: 1.7,  label: 'main subject' },
  P166:  { w: 1.6,  label: 'award received' },
  P1346: { w: 1.6,  label: 'winner' },
  P461:  { w: 1.6,  label: 'opposite of' },
  P3095: { w: 0.7,  label: 'practiced by' },
  P1535: { w: 1.0,  label: 'used by' },
  P1542: { w: 1.4,  label: 'has effect' },
  P828:  { w: 1.4,  label: 'has cause' },
  P485:  { w: 1.5,  label: 'archives at' },
  P1382: { w: 0.8,  label: 'partially coincident with' },
  P710:  { w: 1.6,  label: 'participant' },
  P725:  { w: 1.6,  label: 'voice actor' },
  P598:  { w: 1.6,  label: 'commander of' },
  P50:   { w: 1.6,  label: 'author' },
  P186:  { w: 1.6,  label: 'made from material' },
  P1038: { w: 1.6,  label: 'relative' },
  P509:  { w: 1.0,  label: 'cause of death' },
  P1196: { w: 0.8,  label: 'manner of death' },
  P945:  { w: 0.7,  label: 'allegiance' },
  P859:  { w: 1.0,  label: 'sponsor' },
  P750:  { w: 0.8,  label: 'distributed by' },
  P748:  { w: 1.5,  label: 'appointed by' },
  P57:   { w: 1.5,  label: 'director' },
  P22:   { w: 1.4,  label: 'father' },
  P25:   { w: 1.4,  label: 'mother' },
  P40:   { w: 1.4,  label: 'child' },
  P177:  { w: 1.4,  label: 'crosses' },
  P1056: { w: 1.4,  label: 'product or material produced' },
  P135:  { w: 1.4,  label: 'movement' },
  P607:  { w: 1.3,  label: 'conflict' },
  P3373: { w: 1.2,  label: 'sibling' },
  P161:  { w: 1.2,  label: 'cast member' },
  P463:  { w: 0.6,  label: 'member of' }, // every university belongs to forty consortia
  P108:  { w: 1.2,  label: 'employer' },
  P69:   { w: 1.2,  label: 'educated at' },
  P2578: { w: 1.2,  label: 'studies' },
  P176:  { w: 1.2,  label: 'manufacturer' },
  P178:  { w: 1.2,  label: 'developer' },
  P169:  { w: 1.2,  label: 'chief executive officer' },
  P6:    { w: 1.0,  label: 'head of government' },
  P35:   { w: 1.0,  label: 'head of state' },
  P264:  { w: 1.0,  label: 'record label' },
  P551:  { w: 1.0,  label: 'residence' },
  P2596: { w: 1.0,  label: 'culture' },
  P1416: { w: 1.0,  label: 'affiliation' },
  P488:  { w: 1.0,  label: 'chairperson' },
  P487:  { w: 1.0,  label: 'Unicode character' },
  P39:   { w: 0.9,  label: 'position held' },
  P937:  { w: 0.8,  label: 'work location' },
  P102:  { w: 0.8,  label: 'member of political party' },
  P740:  { w: 0.8,  label: 'location of formation' },
  P885:  { w: 0.8,  label: 'origin of the watercourse' },
  P403:  { w: 0.8,  label: 'mouth of the watercourse' },
  P366:  { w: 0.8,  label: 'has use' },
  P703:  { w: 0.8,  label: 'found in taxon' },
  P277:  { w: 0.8,  label: 'programming language' },
  P241:  { w: 0.7,  label: 'military branch' },
  P462:  { w: 0.2,  label: 'color' },
  P155:  { w: 0.6,  label: 'follows' },
  P156:  { w: 0.6,  label: 'followed by' },
  P179:  { w: 0.6,  label: 'part of the series' },
  P136:  { w: 0.55, label: 'genre' },
  P974:  { w: 0.5,  label: 'tributary' },
  P19:   { w: 0.4,  label: 'place of birth' },
  P20:   { w: 0.4,  label: 'place of death' },
  P159:  { w: 0.3,  label: 'headquarters location' },
  P140:  { w: 0.2,  label: 'religion or worldview' },
  P54:   { w: 0.0,  label: 'member of sports team' },

  /* ── boring: taxonomic and administrative glue ─────────────── */
  P361:  { w: -0.3, label: 'part of' },
  P527:  { w: -0.4, label: 'has part' },
  P452:  { w: -0.5, label: 'industry' },
  P1454: { w: -1.5, label: 'legal form' },
  P2670: { w: -0.6, label: 'has parts of the class' },
  P1552: { w: -0.6, label: 'has characteristic' },
  P400:  { w: -0.7, label: 'platform' },
  P306:  { w: -0.8, label: 'operating system' },
  P101:  { w: -0.8, label: 'field of work' },
  P1050: { w: -0.8, label: 'medical condition' },
  P36:   { w: -1.0, label: 'capital' },
  P1376: { w: -1.0, label: 'capital of' },
  P425:  { w: -1.0, label: 'field of this occupation' },
  P205:  { w: -1.0, label: 'basin country' },
  P106:  { w: -1.1, label: 'occupation' },
  P171:  { w: -1.2, label: 'parent taxon' },
  P276:  { w: -1.2, label: 'location' },
  P1269: { w: -1.4, label: 'facet of' },
  P641:  { w: -1.5, label: 'sport' },
  P413:  { w: -1.5, label: 'position played' },
  P47:   { w: -1.5, label: 'shares border with' },
  P131:  { w: -1.6, label: 'located in the administrative territorial entity' },
  P279:  { w: -1.8, label: 'subclass of' },
  P150:  { w: -2.0, label: 'contains the administrative territorial entity' },
  P27:   { w: -2.0, label: 'country of citizenship' },
  P495:  { w: -2.0, label: 'country of origin' },
  P103:  { w: -2.0, label: 'native language' },
  P1412: { w: -2.0, label: 'language spoken or written' },
  P31:   { w: -2.2, label: 'instance of' },
  P407:  { w: -2.2, label: 'language of work' },
  P37:   { w: -2.2, label: 'official language' },
  P17:   { w: -2.4, label: 'country' },
  P30:   { w: -2.5, label: 'continent' },
  P2936: { w: -2.5, label: 'language used' },
  P734:  { w: -2.5, label: 'family name' },
  P460:  { w: -2.5, label: 'said to be the same as' },
  P282:  { w: -2.2, label: 'writing system' },

  /* ── pruned outright: structural noise ─────────────────────── */
  P1343: { w: -9, label: 'described by source' }, // encyclopedias describe everything — pure wormholes
  P6216: { w: -9, label: 'copyright status' },    // "public domain" is a wormhole too
  P275:  { w: -9, label: 'copyright license' },
  P21:   { w: -9, label: 'sex or gender' },
  P735:  { w: -9, label: 'given name' },
  P105:  { w: -9, label: 'taxon rank' },
  P421:  { w: -9, label: 'time zone' },
  P910:  { w: -9, label: 'topic’s main category' },
  P360:  { w: -9, label: 'is a list of' },
  P1889: { w: -9, label: 'different from' },
  P2860: { w: -9, label: 'cites work' },
  P1753: { w: -9, label: 'list related to category' },
  P1754: { w: -9, label: 'category related to list' },
  P5008: { w: -9, label: 'on focus list' },
  P2354: { w: -9, label: 'has list' },
  P1424: { w: -9, label: 'topic’s main template' },
  P8989: { w: -9, label: 'category for the view' },
  P6104: { w: -9, label: 'maintained by WikiProject' },
  P2959: { w: -9, label: 'permanent duplicated item' },
  P1151: { w: -9, label: 'topic’s main Wikimedia portal' },
  P301:  { w: -9, label: 'category’s main topic' },
  P971:  { w: -9, label: 'category combines topics' },
  P4224: { w: -9, label: 'category contains' },
  P8225: { w: -9, label: 'is metaclass for' },   // ontology plumbing, not a story
  P7763: { w: -9, label: 'copyright status as a creator' }, // yet another copyright wormhole
  P141:  { w: -9, label: 'IUCN conservation status' },      // "Vulnerable" connects half of biology
  P853:  { w: -9, label: 'CERO rating' },                   // "All ages" connects every game
  P852:  { w: -9, label: 'ESRB rating' },
  P908:  { w: -9, label: 'PEGI rating' },
  P1657: { w: -9, label: 'MPA film rating' },
};

export function propWeight(p) {
  const m = PROP_META[p];
  return m ? m.w : DEFAULT_PROP_WEIGHT;
}

export function propLabel(p, fallback = null) {
  const m = PROP_META[p];
  return m ? m.label : (fallback || p);
}

/* ── hub damping: keep the route off the interstate ─────────── */

export const HUB_PENALTY = new Map(Object.entries({
  Q5: -3.0,        // human
  Q30: -2.6,       // United States
  Q145: -2.4,      // United Kingdom
  Q142: -2.2,      // France
  Q183: -2.2,      // Germany
  Q159: -2.2,      // Russia
  Q148: -2.2,      // China
  Q17: -2.0,       // Japan
  Q16: -2.0,       // Canada
  Q38: -2.0,       // Italy
  Q29: -2.0,       // Spain
  Q668: -2.0,      // India
  Q408: -2.0,      // Australia
  Q2: -2.0,        // Earth
  Q1860: -2.6,     // English
  Q188: -2.2,      // German
  Q150: -2.2,      // French
  Q1321: -2.2,     // Spanish
  Q7737: -2.2,     // Russian
  Q16521: -2.4,    // taxon
  Q7432: -2.0,     // species
  Q6256: -2.2,     // country
  Q3624078: -2.2,  // sovereign state
  Q515: -2.0,      // city
  Q1549591: -1.8,  // big city
  Q532: -1.8,      // village
  Q35120: -3.0,    // entity
  Q488383: -3.0,   // object
  Q4830453: -3.0,  // business
  Q43229: -3.0,    // organization
  Q783794: -2.6,   // company
  Q6881511: -2.6,  // enterprise
  Q891723: -2.2,   // public company
  Q28640: -2.2,    // profession
  Q12737077: -2.2, // occupation
  Q4164871: -2.2,  // position
  Q101352: -3.0,   // family name
  Q202444: -3.0,   // given name
  Q571: -1.8,      // book
  Q11424: -1.6,    // film
  Q5398426: -1.6,  // television series
  Q482994: -1.6,   // album
  Q134556: -1.6,   // single
  Q7366: -1.4,     // song
  Q13442814: -2.6, // scholarly article
  Q4022: -1.6,     // river
  Q8502: -1.6,     // mountain
  Q23397: -1.4,    // lake
  Q60: -1.4,       // New York City
  Q84: -1.4,       // London
  Q90: -1.4,       // Paris
  Q65: -1.2,       // Los Angeles
  Q1490: -1.2,     // Tokyo
  Q64: -1.2,       // Berlin
  Q3918: -1.2,     // university
  Q95074: -1.6,    // fictional character (class item itself)
  Q215627: -2.4,   // person
  Q795052: -2.4,   // individual
  Q178885: -1.6,   // deity
  Q11446: -1.2,    // ship
  Q1071: -1.4,     // geography? (guarded anyway)
}));

export function hubPenalty(qid) {
  return HUB_PENALTY.get(qid) || 0;
}

/* ── forbidden intermediates ──────────────────────────────────
   Ultra-generic class nodes make a chain illegible: "X is a
   human, and so is Y" explains nothing. These may serve as
   endpoints (if the user asks) but never as through-stations —
   except as a desperate first hop out of a sparse endpoint,
   at a stiff price (see pathfinder). */

export const FORBIDDEN_NODES = new Set([
  'Q5',        // human
  'Q215627',   // person
  'Q795052',   // individual
  'Q35120',    // entity
  'Q488383',   // object
  'Q151885',   // concept
  'Q16334295', // group of humans
  'Q28640',    // profession
  'Q12737077', // occupation
  'Q4164871',  // position
  'Q4830453',  // business
  'Q43229',    // organization
  'Q6256',     // country
  'Q3624078',  // sovereign state
  'Q1860',     // English language
  'Q8434',     // education
  'Q11862829', // academic discipline
  'Q336',      // science
  'Q11424',    // film (the class)
  'Q5398426',  // television series (the class)
  'Q482994',   // album (the class)
  'Q7366',     // song (the class)
  'Q571',      // book (the class)
  'Q101352',   // family name
  'Q202444',   // given name
  'Q19478619', // metaclass
  'Q23766486', // list of values as qualifiers (Wikidata plumbing)
]);

/** Concreteness prior, computed when a node is expanded and
    applied to every path that continues through it. Things with
    a face — images, birthdates, coordinates, an inception —
    make satisfying stops; things with subclasses are
    abstractions, and abstractions are where stories go to die. */
export function classPenalty(entity) {
  const c = (entity && entity.claims) || {};
  let p = 0;
  if (c.P279) p -= 1.25;                // it's a class of things
  if (c.P18) p += 0.4;                  // has a picture
  if (c.P569 || c.P570) p += 0.35;      // born / died — a life
  if (c.P625) p += 0.3;                 // somewhere on the map
  if (c.P571 || c.P577) p += 0.2;       // came into being at a moment
  return Math.max(-1.5, Math.min(0.9, p));
}

/** Degree damping applied when a node is expanded: busy nodes tax
    every path that continues through them (log-scaled, like
    inverse-degree edge weighting in path-relevance measures). */
export function degreePenalty(linkCount) {
  if (linkCount <= 40) return 0;
  return -0.55 * Math.log10(linkCount / 40) * 3.32; // ≈ -0.55 per doubling
}

/* ── final path shaping: scenic, but narratable ─────────────── */

export function shapeBonus(hops) {
  // many small, sensical steps beat few big leaps: peak around 7–8,
  // gentle tolerance out to 11, then the tale starts to outstay its welcome
  return 1.8 - Math.abs(hops - 7.5) * 0.3 - Math.max(0, hops - 11) * 0.8;
}

/* ── randomness: Gumbel noise for stochastic beam sampling ──── */

export function gumbel(rng) {
  return -Math.log(-Math.log(Math.max(rng(), 1e-12)));
}

/** mulberry32 — tiny seeded PRNG so runs are shareable/replayable */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
