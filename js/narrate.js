/* ══════════════════════════════════════════════════════════════
   narrate.js — turns a path of raw claims into a tale.

   Every hop is a real Wikidata statement with a direction:
   'fwd'  = claim reads  A --prop--> B  (we travel with the arrow)
   'rev'  = claim reads  B --prop--> A  (we travel against it)
   Templates are direction-aware so the prose never lies about
   which way the fact points. {a} = where we stand, {b} = arrival.
   ══════════════════════════════════════════════════════════════ */

import { propLabel } from './scoring.js';

const T = {
  P138:  { fwd: ['{a} is named after {b}', '{a} takes its very name from {b}'],
           rev: ['{b} is named in {a}’s honor', '{b} takes its name from {a}'] },
  P941:  { fwd: ['{a} was inspired by {b}'], rev: ['{a} went on to inspire {b}'] },
  P737:  { fwd: ['{a} was influenced by {b}'], rev: ['{a} left fingerprints all over {b}'] },
  P144:  { fwd: ['{a} is based on {b}'], rev: ['{a} became the basis for {b}'] },
  P1441: { fwd: ['{a} makes an appearance in {b}'], rev: ['{b} makes an appearance in {a}'] },
  P825:  { fwd: ['{a} is dedicated to {b}'], rev: ['{b} is dedicated to {a}'] },
  P61:   { fwd: ['{a} owes its discovery to {b}', '{a} was first devised by {b}'],
           rev: ['{a} devised {b}', '{a} is credited with discovering {b}'] },
  P749:  { fwd: ['{a} answers to {b}'], rev: ['{a} oversees {b}'] },
  P797:  { fwd: ['{a} is administered by {b}'], rev: ['{a} administers {b}'] },
  P1308: { fwd: ['the office of {a} is held, these days, by {b}'], rev: ['{a} holds the office of {b}'] },
  P2388: { fwd: ['{a} comes with the office of {b}'], rev: ['{b} comes with the office of {a}'] },
  P461:  { fwd: ['{a} is the sworn opposite of {b}'], rev: ['{a} is the sworn opposite of {b}'] },
  P119:  { fwd: ['{a} was laid to rest at {b}'], rev: ['{a} is the resting place of {b}'] },
  P1196: { fwd: ['{a} died of {b}'], rev: ['{a} is how {b} went'] },
  P859:  { fwd: ['{a} was bankrolled by {b}'], rev: ['{a} bankrolled {b}'] },
  P750:  { fwd: ['{a} reaches the world through {b}'], rev: ['{a} distributes {b}'] },
  P159:  { fwd: ['{a} keeps its headquarters in {b}'], rev: ['{b} keeps its headquarters in {a}'] },
  P945:  { fwd: ['{a} served under the flag of {b}'], rev: ['{b} served under the flag of {a}'] },
  P171:  { fwd: ['{a} belongs to the family {b}'], rev: ['{b} belongs to the family {a}'] },
  P1037: { fwd: ['{a} is run by {b}'], rev: ['{a} runs {b}'] },
  P6379: { fwd: ['{a} hangs in {b}'], rev: ['{a} holds a work by {b}'] },
  P241:  { fwd: ['{a} served in {b}'], rev: ['{b} counts {a} among its ranks'] },
  P123:  { fwd: ['{a} was published by {b}'], rev: ['{a} published {b}'] },
  P2789: { fwd: ['{a} connects to {b}'], rev: ['{a} connects to {b}'] },
  P190:  { fwd: ['{a} is twinned with {b}'], rev: ['{a} is twinned with {b}'] },
  P1990: { fwd: ['{a} keeps {b}'], rev: ['{b} is kept at {a}'] },
  P6364: { fwd: ['{a}’s colour is {b}'], rev: ['{b} is the colour of {a}'] },
  P8371: { fwd: ['{a} tips its hat to {b}'], rev: ['{b} tips its hat to {a}'] },
  P1365: { fwd: ['{a} took the place of {b}'], rev: ['{a} was replaced by {b}'] },
  P853:  { fwd: ['{a} is rated {b}'], rev: ['{b} is the rating of {a}'] },
  P2650: { fwd: ['{a} takes an interest in {b}'], rev: ['{b} takes an interest in {a}'] },
  P488:  { fwd: ['{a} is chaired by {b}'], rev: ['{a} chaired {b}'] },
  P137:  { fwd: ['{a} is operated by {b}'], rev: ['{a} operated {b}'] },
  P1029: { fwd: ['{a}’s crew included {b}'], rev: ['{a} crewed aboard {b}'] },
  P674:  { fwd: ['{a}’s characters include {b}'], rev: ['{a} is a character in {b}'] },
  P452:  { fwd: ['{a} is in the business of {b}'], rev: ['{b} is in the business of {a}'] },
  P140:  { fwd: ['{a} was, in faith, {b}'], rev: ['{b} was, in faith, {a}'] },
  P414:  { fwd: ['{a} is listed on {b}'], rev: ['{b} is listed on {a}'] },
  P376:  { fwd: ['{a} sits on {b}'], rev: ['{b} sits on {a}'] },
  P98:   { fwd: ['{a} was edited by {b}'], rev: ['{a} edited {b}'] },
  P1433: { fwd: ['{a} ran in {b}'], rev: ['{a} ran {b}'] },
  P840:  { fwd: ['{a} is set in {b}'], rev: ['{b} is set in {a}'] },
  P530:  { fwd: ['{a} keeps diplomatic ties with {b}'], rev: ['{a} keeps diplomatic ties with {b}'] },
  P8047: { fwd: ['{a} is registered in {b}'], rev: ['{b} is registered in {a}'] },
  P1366: { fwd: ['{a} gave way to {b}'], rev: ['{a} took over from {b}'] },
  P641:  { fwd: ['{a} belongs to the sport of {b}'], rev: ['{b} belongs to the sport of {a}'] },
  P1269: { fwd: ['{a} is one facet of {b}'], rev: ['{b} is one facet of {a}'] },
  P69:   { fwd: ['{a} was educated at {b}', '{a} got their schooling by way of {b}'],
           rev: ['{b} studied at {a}'] },
  P1382: { fwd: ['{a} shades, imperceptibly, into {b}'], rev: ['{a} shades, imperceptibly, into {b}'] },
  P460:  { fwd: ['{a} is said — by some — to be the same as {b}'], rev: ['{a} is said — by some — to be the same as {b}'] },
  P485:  { fwd: ['{a}’s papers are kept at {b}'], rev: ['{a} keeps the papers of {b}'] },
  P3342: { fwd: ['{a}’s story is entangled with {b}'], rev: ['{a}’s story is entangled with {b}'] },
  P547:  { fwd: ['{a} commemorates {b}'], rev: ['{b} was raised to commemorate {a}'] },
  P1877: { fwd: ['{a} is after a work by {b}'], rev: ['{a}’s work begat {b}'] },
  P4969: { fwd: ['{a} spawned the derivative work {b}'], rev: ['{b} is a derivative of {a}'] },
  P793:  { fwd: ['{a} lived through {b}', '{a}’s history turns on {b}'],
           rev: ['{b} counts {a} among its defining events'] },
  P1830: { fwd: ['{a} owns {b}'], rev: ['{b} owns {a}'] },
  P127:  { fwd: ['{a} is owned by {b}'], rev: ['{b} belongs to {a}'] },
  P180:  { fwd: ['{a} depicts {b}'], rev: ['{b} depicts {a}'] },
  P287:  { fwd: ['{a} was designed by {b}'], rev: ['{a} designed {b}'] },
  P88:   { fwd: ['{a} was commissioned by {b}'], rev: ['{a} commissioned {b}'] },
  P1344: { fwd: ['{a} took part in {b}'], rev: ['{b} took part in {a}'] },
  P800:  { fwd: ['{a}’s notable works include {b}'], rev: ['{b} counts {a} among their notable works'] },
  P184:  { fwd: ['{a} studied under {b}'], rev: ['{a} was doctoral advisor to {b}'] },
  P185:  { fwd: ['{a} advised the doctorate of {b}'], rev: ['{b} advised {a}'] },
  P1066: { fwd: ['{a} was a student of {b}'], rev: ['{a} taught {b}'] },
  P802:  { fwd: ['{a} taught {b}'], rev: ['{b} taught {a}'] },
  P1080: { fwd: ['{a} belongs to the world of {b}'], rev: ['{b} belongs to the world of {a}'] },
  P170:  { fwd: ['{a} was created by {b}'], rev: ['{a} created {b}'] },
  P86:   { fwd: ['{a} was composed by {b}'], rev: ['{a} composed {b}'] },
  P175:  { fwd: ['{a} was performed by {b}'], rev: ['{a} performed {b}'] },
  P84:   { fwd: ['{a} was designed by the architect {b}'], rev: ['{a} was the architect of {b}'] },
  P26:   { fwd: ['{a} married {b}'], rev: ['{b} married {a}'] },
  P451:  { fwd: ['{a} was the partner of {b}'], rev: ['{b} was the partner of {a}'] },
  P1303: { fwd: ['{a} plays the {b}', '{a}’s instrument of choice is the {b}'],
           rev: ['{b} is inseparable from the {a}', 'the {a} found its champion in {b}'] },
  P112:  { fwd: ['{a} was founded by {b}'], rev: ['{a} founded {b}'] },
  P676:  { fwd: ['{a}’s lyrics were written by {b}'], rev: ['{a} wrote the lyrics of {b}'] },
  P921:  { fwd: ['{a} is chiefly about {b}'], rev: ['{b} is chiefly about {a}'] },
  P710:  { fwd: ['{a} drew in {b} as a participant'], rev: ['{a} was a participant in {b}'] },
  P725:  { fwd: ['{a} was voiced by {b}'], rev: ['{a} lent their voice to {b}'] },
  P598:  { fwd: ['{a} commanded {b}'], rev: ['{b} commanded {a}'] },
  P50:   { fwd: ['{a} was written by {b}'], rev: ['{a} wrote {b}'] },
  P186:  { fwd: ['{a} is made from {b}'], rev: ['{a} is the stuff {b} is made of'] },
  P1038: { fwd: ['{a} is kin to {b}'], rev: ['{b} is kin to {a}'] },
  P509:  { fwd: ['{a} was carried off by {b}'], rev: ['{b} met their end through {a}'] },
  P748:  { fwd: ['{a} was appointed by {b}'], rev: ['{a} appointed {b}'] },
  P57:   { fwd: ['{a} was directed by {b}'], rev: ['{a} directed {b}'] },
  P22:   { fwd: ['{a}’s father was {b}'], rev: ['{a} was father to {b}'] },
  P25:   { fwd: ['{a}’s mother was {b}'], rev: ['{a} was mother to {b}'] },
  P40:   { fwd: ['{a} was parent to {b}'], rev: ['{b} was parent to {a}'] },
  P177:  { fwd: ['{a} crosses {b}'], rev: ['{b} crosses {a}'] },
  P1056: { fwd: ['{a} produces {b}'], rev: ['{b} produces {a}'] },
  P135:  { fwd: ['{a} belongs to the {b} movement'], rev: ['the {a} movement claims {b}'] },
  P607:  { fwd: ['{a} saw action in {b}'], rev: ['{b} saw action in {a}'] },
  P3373: { fwd: ['{a}’s sibling is {b}'], rev: ['{b}’s sibling is {a}'] },
  P161:  { fwd: ['{a}’s cast includes {b}'], rev: ['{a} appeared in {b}'] },
  P463:  { fwd: ['{a} is a member of {b}'], rev: ['{b} counts {a} among its members'] },
  P108:  { fwd: ['{a} worked for {b}'], rev: ['{b} worked for {a}'] },
  P2578: { fwd: ['{a} is the study of {b}'], rev: ['{b} is what studies {a}'] },
  P101:  { fwd: ['{a} works in the field of {b}'], rev: ['{b} made {a} their life’s work'] },
  P166:  { fwd: ['{a} was awarded the {b}'], rev: ['{a} was pinned on {b}'] },
  P1346: { fwd: ['{a} was won by {b}'], rev: ['{a} won {b}'] },
  P425:  { fwd: ['{b} is the whole trade of the {a}'], rev: ['{a} is the whole trade of the {b}'] },
  P3095: { fwd: ['{a} is practiced by {b}'], rev: ['{a} practices {b}'] },
  P1535: { fwd: ['{a} is used by {b}'], rev: ['{a} makes use of {b}'] },
  P828:  { fwd: ['{a} came about because of {b}'], rev: ['{a} brought about {b}'] },
  P1542: { fwd: ['{a} brought about {b}'], rev: ['{a} came about because of {b}'] },
  P176:  { fwd: ['{a} is manufactured by {b}'], rev: ['{a} manufactures {b}'] },
  P178:  { fwd: ['{a} was developed by {b}'], rev: ['{a} developed {b}'] },
  P169:  { fwd: ['{a} is run by {b}'], rev: ['{a} runs {b}'] },
  P6:    { fwd: ['{a} was governed, for a time, by {b}'], rev: ['{a} governed, for a time, {b}'] },
  P35:   { fwd: ['{a}’s head of state is {b}'], rev: ['{a} is head of state of {b}'] },
  P264:  { fwd: ['{a} records for {b}'], rev: ['{b} records for {a}'] },
  P551:  { fwd: ['{a} lived in {b}'], rev: ['{b} made a home in {a}'] },
  P39:   { fwd: ['{a} held the office of {b}'], rev: ['{b} held the office of {a}'] },
  P937:  { fwd: ['{a} worked in {b}'], rev: ['{b} worked in {a}'] },
  P102:  { fwd: ['{a} belonged to {b}'], rev: ['{b} belonged to {a}'] },
  P740:  { fwd: ['{a} got its start in {b}'], rev: ['{b} got its start in {a}'] },
  P366:  { fwd: ['{a} is used for {b}'], rev: ['{b} is what {a} is for'] },
  P703:  { fwd: ['{a} is found in {b}'], rev: ['{b} is found in {a}'] },
  P462:  { fwd: ['{a} comes in {b}'], rev: ['{b} is the color of {a}'] },
  P155:  { fwd: ['{a} follows {b}'], rev: ['{b} follows {a}'] },
  P156:  { fwd: ['{a} is followed by {b}'], rev: ['{a} follows {b}'] },
  P179:  { fwd: ['{a} is a chapter of {b}'], rev: ['{b} is a chapter of {a}'] },
  P136:  { fwd: ['{a} works in the genre of {b}'], rev: ['{a} is the genre {b} calls home'] },
  P19:   { fwd: ['{a} was born in {b}'], rev: ['{b} was born in {a}'] },
  P20:   { fwd: ['{a} died in {b}'], rev: ['{b} died in {a}'] },
  P31:   { fwd: ['{a} is, officially, a kind of {b}'], rev: ['{b} happens to be, among other things, a {a}'] },
  P279:  { fwd: ['{a} is a species of {b}'], rev: ['{b} is a species of {a}'] },
  P17:   { fwd: ['{a} sits in {b}'], rev: ['{b} sits in {a}'] },
  P361:  { fwd: ['{a} is part of {b}'], rev: ['{b} is part of {a}'] },
  P527:  { fwd: ['{a} contains {b}'], rev: ['{b} contains {a}'] },
  P106:  { fwd: ['{a} worked as a {b}'], rev: ['{b} worked as a {a}'] },
  P495:  { fwd: ['{a} hails from {b}'], rev: ['{b} gave the world {a}'] },
  P27:   { fwd: ['{a} was a citizen of {b}'], rev: ['{b} counted {a} among its citizens'] },
  P131:  { fwd: ['{a} sits within {b}'], rev: ['{b} sits within {a}'] },
  P36:   { fwd: ['{a}’s capital is {b}'], rev: ['{b}’s capital is {a}'] },
  P47:   { fwd: ['{a} shares a border with {b}'], rev: ['{b} shares a border with {a}'] },
  P276:  { fwd: ['{a} is to be found in {b}'], rev: ['{b} is to be found in {a}'] },
  P30:   { fwd: ['{a} lies on the continent of {b}'], rev: ['{b} lies on the continent of {a}'] },
  P195:  { fwd: ['{a} lives in the collection of {b}'], rev: ['{b} holds {a} in its collection'] },
  P2541: { fwd: ['{a} operates across {b}'], rev: ['{b} is where {a} operates'] },
  P9493: { fwd: ['{a}’s artist file is kept at {b}'], rev: ['{b}’s artist file is kept at {a}'] },
  P407:  { fwd: ['{a} is written in {b}'], rev: ['{b} is the language of {a}'] },
  P1412: { fwd: ['{a} spoke {b}'], rev: ['{b} was a tongue of {a}'] },
  P277:  { fwd: ['{a} is written in {b}'], rev: ['{b} is the language {a} is written in'] },
  P1416: { fwd: ['{a} is affiliated with {b}'], rev: ['{b} is affiliated with {a}'] },
  P162:  { fwd: ['{a} was produced by {b}'], rev: ['{a} produced {b}'] },
};

export { T as TEMPLATES };

const OPENERS = [
  '', 'From there, ', 'And ', 'Now, ', 'Naturally, ', 'Here the trail bends: ',
  'As it happens, ', 'Improbably enough, ', 'Follow that thread, and ',
  'One more turn: ', 'Keep walking: ', 'Believe it or not, ', 'Meanwhile, ',
  'The plot thickens — ', 'And wouldn’t you know it, ',
];

const INTROS = [
  'Everyone knows the shortest distance between two points is a straight line. This, gloriously, is not that.',
  'We packed light, ignored the highway, and let the world’s knowledge choose the turns.',
  'What follows is entirely true, verifiable, and completely unnecessary. That’s the point.',
  'No shortcuts were taken in the making of this journey. Several were actively refused.',
  'The atlas offered a straight line. We politely declined.',
];

const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen'];

function numWord(n) { return NUM_WORDS[n] || String(n); }

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

// fix "a actor" → "an actor" for vowel-initial fills after the article
function fixArticles(s) {
  return s.replace(/\ba (?=[aeiouAEIOU])/g, 'an ');
}

function fill(tpl, a, b) { return fixArticles(tpl.replace('{a}', a).replace('{b}', b)); }

function capFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** One clause for a hop: direction-aware, template-first, honest fallback. */
export function hopClause(hop, aLabel, bLabel, propLabels, rng = Math.random) {
  const t = T[hop.prop];
  if (t) {
    const arr = hop.dir === 'fwd' ? t.fwd : t.rev;
    return fill(pick(rng, arr), aLabel, bLabel);
  }
  const p = propLabel(hop.prop, propLabels.get(hop.prop));
  return hop.dir === 'fwd'
    ? `${aLabel}’s “${p}” is ${bLabel}`
    : `${bLabel} lists ${aLabel} under “${p}”`;
}

/**
 * Assemble the full tale.
 * @returns { title, intro, hopSentences[], outro, shortcutLine, plainText }
 */
export function narrate({ path, cards, propLabels, shortest, stats, rng = Math.random }) {
  const nodes = path.nodes;
  const label = id => (cards.get(id)?.label) || id;
  const A = label(nodes[0]);
  const B = label(nodes[nodes.length - 1]);
  const n = path.hopCount;

  const title = pick(rng, [
    `From ${A} to ${B} in ${numWord(n)} improbable steps`,
    `${A} to ${B}, the long way round`,
    `How ${A} leads, eventually, to ${B}`,
    `The scenic route from ${A} to ${B}`,
  ]);

  const intro = pick(rng, INTROS);

  const hopSentences = [];
  const usedOpeners = new Set(['']);
  for (let i = 0; i < n; i++) {
    const clause = hopClause(path.hops[i], label(nodes[i]), label(nodes[i + 1]), propLabels, rng);
    let opener = '';
    if (i > 0) {
      let tries = 0;
      do { opener = pick(rng, OPENERS); tries++; } while (usedOpeners.has(opener) && tries < 8);
      usedOpeners.add(opener);
    }
    const sentence = opener ? opener + clause + '.' : capFirst(clause) + '.';
    hopSentences.push(sentence);
  }

  const outro = pick(rng, [
    `And so, ${numWord(n)} turns later, we arrive: from ${A} to ${B}, the long way round — past ${stats.explored.toLocaleString()} crossroads, having politely declined every shortcut.`,
    `Which is how ${A} and ${B} turn out to be ${numWord(n)} handshakes apart — if you shake the right, ridiculous hands.`,
    `${numWord(n).charAt(0).toUpperCase() + numWord(n).slice(1)} steps, zero coincidences: every link above is a documented fact. The world is simply better connected than it lets on.`,
  ]);

  let shortcutLine = null;
  if (shortest && shortest.hopCount < n) {
    const via = shortest.hopCount === 1
      ? 'a single dreary link'
      : `${numWord(shortest.hopCount)} forgettable links`;
    shortcutLine = `For the record: there is a shortcut — ${via} would have done it. We took ${numWord(n)} instead. You’re welcome.`;
  }

  const plainLines = [
    title.toUpperCase(), '', intro, '',
    `⚑ ${A}${cards.get(nodes[0])?.description ? ' — ' + cards.get(nodes[0]).description : ''}`,
  ];
  for (let i = 0; i < n; i++) {
    const c = cards.get(nodes[i + 1]);
    plainLines.push(`  ↓ ${hopSentences[i]}`);
    plainLines.push(`⚑ ${label(nodes[i + 1])}${c?.description ? ' — ' + c.description : ''}`);
  }
  plainLines.push('', outro);
  if (shortcutLine) plainLines.push('', shortcutLine);
  plainLines.push('', '— charted by The Long Way Round, on the rails of Wikidata (CC0)');

  return { title, intro, hopSentences, outro, shortcutLine, plainText: plainLines.join('\n') };
}
