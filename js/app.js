/* ══════════════════════════════════════════════════════════════
   app.js — the conductor. Autocomplete, the expedition itself,
   and the telling of the tale.
   ══════════════════════════════════════════════════════════════ */

import { searchEntities, resolveEntity, getCards, getPropertyLabels, getInterestingNeighbors, entityUrl } from './wikidata.js';
import { findPath, computeUsedEdges, trimCycles } from './pathfinder.js';
import { narrate } from './narrate.js';
import { Constellation, drawRoad } from './viz.js';
import { PROP_META, propLabel, propWeight, makeRng, PRUNE } from './scoring.js';

const $ = id => document.getElementById(id);

const el = {
  board: $('board'), controls: $('controls'), error: $('board-error'),
  inputFrom: $('input-from'), inputTo: $('input-to'),
  acFrom: $('ac-from'), acTo: $('ac-to'),
  pickedFrom: $('picked-from'), pickedTo: $('picked-to'),
  btnSwap: $('btn-swap'), btnDice: $('btn-dice'), btnGo: $('btn-go'),
  expedition: $('expedition'), expeditionTitle: $('expedition-title'),
  ticker: $('ticker'), constellation: $('constellation'),
  legFrom: $('leg-from-label'), legTo: $('leg-to-label'),
  statExplored: $('stat-explored'), statFrontier: $('stat-frontier'), statMeetings: $('stat-meetings'),
  tale: $('tale'), taleTitle: $('tale-title'), taleIntro: $('tale-intro'),
  shortcutTease: $('shortcut-tease'), journey: $('journey'),
  journeyRoad: $('journey-road'), journeyStops: $('journey-stops'),
  taleOutro: $('tale-outro'), taleStats: $('tale-stats'),
  btnAgain: $('btn-again'), btnCopy: $('btn-copy'), btnShare: $('btn-share'), btnNew: $('btn-new'),
  lost: $('lost'), btnRetry: $('btn-retry'), btnLostNew: $('btn-lost-new'),
};

/* ─────────── delightful seed pairs for the dice ─────────── */

const SEEDS = [
  'Medicaid', 'banjo', 'croissant', 'black hole', 'Genghis Khan', 'Eiffel Tower',
  'penicillin', 'tango', 'Saturn', 'Bauhaus', 'sushi', 'Alan Turing', 'ukulele',
  'Route 66', 'Marie Curie', 'chess', 'bubble wrap', 'Mount Everest', 'jazz',
  'Rosetta Stone', 'Nintendo', 'absinthe', 'lighthouse', 'Vincent van Gogh',
  'accordion', 'Antarctica', 'typewriter', 'origami', 'Hubble Space Telescope',
  'Cleopatra', 'maple syrup', 'roller coaster', 'Sherlock Holmes', 'platypus',
  'disco', 'Trans-Siberian Railway', 'sourdough', 'Morse code', 'kimono',
  'the Moon', 'harmonica', 'Petra', 'Niagara Falls', 'saxophone', 'Voyager 1',
];

const TICKER_LINES = [
  'Rummaging through the world’s attic…',
  'Politely declining the interstate…',
  'Asking directions from a hundred strangers…',
  'Unfolding a map that never quite refolds…',
  'Following a hunch past the taxonomy section…',
  'Taking the turn the shortcut wouldn’t…',
  'Consulting the world’s most pedantic librarians…',
  'Counting crossroads, keeping the odd ones…',
  'Ignoring everything sensible…',
  'Trading breadcrumbs with the other expedition…',
];

/* ─────────── state ─────────── */

const state = {
  from: null, to: null,            // {id, label, description}
  running: false,
  control: null,
  constellation: null,
  avoidEdges: new Set(),
  avoidNodes: new Set(),
  temperature: 0.7,
  requiredHops: null,              // "take an even longer way" escalates this
  lastPairKey: null,
  lastResult: null,
  lastTale: null,
  routeOptions: null,              // [best, ...alternates] for the route chips
  activeRoute: null,
  seed: null,
  tickerTimer: null,
};

/* ─────────── autocomplete ─────────── */

function setupAutocomplete(input, list, pickedEl, key) {
  let timer = null;
  let items = [];

  const close = () => { list.classList.remove('open'); list.innerHTML = ''; items = []; };

  const render = (results) => {
    items = results;
    list.innerHTML = '';
    for (const r of results) {
      const div = document.createElement('div');
      div.className = 'ac-item';
      div.setAttribute('role', 'option');
      div.innerHTML = `<span class="ac-label"></span><span class="ac-desc"></span>`;
      div.querySelector('.ac-label').textContent = r.label;
      div.querySelector('.ac-desc').textContent = r.description || 'no description — mysterious';
      div.addEventListener('mousedown', (e) => { e.preventDefault(); choose(r); });
      list.appendChild(div);
    }
    list.classList.toggle('open', results.length > 0);
  };

  const choose = (r) => {
    state[key] = r;
    input.value = r.label;
    pickedEl.hidden = false;
    pickedEl.innerHTML = '';
    const b = document.createElement('b'); b.textContent = r.label;
    pickedEl.append(b, r.description ? ` — ${r.description}` : ' — locked in');
    close();
  };

  input.addEventListener('input', () => {
    state[key] = null;
    pickedEl.hidden = true;
    clearTimeout(timer);
    const q = input.value;
    if (!q.trim()) { close(); return; }
    timer = setTimeout(async () => {
      try { render(await searchEntities(q)); } catch { close(); }
    }, 220);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (items.length) choose(items[0]); else go(); }
    if (e.key === 'Escape') close();
  });

  input.addEventListener('blur', () => setTimeout(close, 150));
}

setupAutocomplete(el.inputFrom, el.acFrom, el.pickedFrom, 'from');
setupAutocomplete(el.inputTo, el.acTo, el.pickedTo, 'to');

/* ─────────── controls ─────────── */

el.btnSwap.addEventListener('click', () => {
  [state.from, state.to] = [state.to, state.from];
  [el.inputFrom.value, el.inputTo.value] = [el.inputTo.value, el.inputFrom.value];
  const pf = el.pickedFrom.innerHTML, ph = el.pickedFrom.hidden;
  el.pickedFrom.innerHTML = el.pickedTo.innerHTML; el.pickedFrom.hidden = el.pickedTo.hidden;
  el.pickedTo.innerHTML = pf; el.pickedTo.hidden = ph;
});

el.btnDice.addEventListener('click', () => {
  const i = Math.floor(Math.random() * SEEDS.length);
  let j; do { j = Math.floor(Math.random() * SEEDS.length); } while (j === i);
  el.inputFrom.value = SEEDS[i]; el.inputTo.value = SEEDS[j];
  state.from = null; state.to = null;
  el.pickedFrom.hidden = true; el.pickedTo.hidden = true;
  el.error.hidden = true;
});

el.btnGo.addEventListener('click', () => go());
el.controls.addEventListener('submit', (e) => { e.preventDefault(); go(); });

el.btnAgain.addEventListener('click', () => rerun());
el.btnRetry.addEventListener('click', () => rerun());
el.btnNew.addEventListener('click', () => resetToBoard());
el.btnLostNew.addEventListener('click', () => resetToBoard());

el.btnCopy.addEventListener('click', async () => {
  if (!state.lastTale) return;
  await navigator.clipboard.writeText(state.lastTale.plainText);
  flashButton(el.btnCopy, '✓ Copied');
});

el.btnShare.addEventListener('click', async () => {
  if (!state.from || !state.to) return;
  const u = new URL(location.href.split('?')[0]);
  u.searchParams.set('from', state.from.id);
  u.searchParams.set('to', state.to.id);
  u.searchParams.set('fl', state.from.label);
  u.searchParams.set('tl', state.to.label);
  if (state.seed != null) u.searchParams.set('seed', String(state.seed));
  await navigator.clipboard.writeText(u.toString());
  flashButton(el.btnShare, '✓ Link copied');
});

function flashButton(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1600);
}

/* ─────────── the expedition ─────────── */

async function resolveEndpoint(key, input) {
  if (state[key]) return state[key];
  const q = input.value.trim();
  if (!q) return null;
  const pick = await resolveEntity(q);
  if (!pick) return null;
  state[key] = pick;
  return pick;
}

async function go(seedOverride = null) {
  if (state.running) return;
  el.error.hidden = true;

  el.btnGo.disabled = true;
  el.btnGo.textContent = 'Consulting the atlas…';

  let from, to;
  try {
    [from, to] = await Promise.all([
      resolveEndpoint('from', el.inputFrom),
      resolveEndpoint('to', el.inputTo),
    ]);
  } catch (e) {
    showError('The atlas is unreachable — check your connection and try again.');
    return;
  }

  if (!from || !to) { showError('Name both ends of the journey — anything at all. Try the dice.'); return; }
  if (from.id === to.id) { showError('That trip takes zero steps, however you slice it. Pick two different things.'); return; }

  // a new pair means a fresh expedition: forget the old route's grudges
  const pairKey = from.id + '|' + to.id;
  if (pairKey !== state.lastPairKey) {
    state.lastPairKey = pairKey;
    state.avoidEdges = new Set();
    state.requiredHops = null;
    state.temperature = 0.7;
  }

  state.running = true;
  state.seed = seedOverride ?? (Date.now() & 0x7fffffff);
  state.control = { cancelled: false };

  // stage reset
  el.tale.hidden = true;
  el.lost.hidden = true;
  el.expedition.hidden = false;
  el.expeditionTitle.textContent = `Charting ${from.label} → ${to.label}, the long way…`;
  el.legFrom.textContent = from.label;
  el.legTo.textContent = to.label;
  el.statExplored.textContent = '0';
  el.statFrontier.textContent = '2';
  el.statMeetings.textContent = '0';

  if (state.constellation) state.constellation.destroy();
  hidePopover();
  state.constellation = new Constellation(el.constellation);
  state.constellation.setOrigins(from.id, to.id);
  state.constellation.onNodeClick = showNodePopover;

  startTicker();
  el.expedition.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const onEvent = (ev) => {
    const c = state.constellation;
    if (!c) return;
    if (ev.type === 'node') c.enqueue(ev);
    else if (ev.type === 'labels') c.enqueueLabels(ev.map);
    else if (ev.type === 'meet') {
      c.markMeet(ev.id);
      el.statMeetings.textContent = String(ev.meetings);
      setTicker(`The trails just crossed — ${ev.hops} steps end to end. Looking for a stranger route…`);
    } else if (ev.type === 'progress') {
      el.statExplored.textContent = ev.explored.toLocaleString();
      el.statFrontier.textContent = ev.frontier.toLocaleString();
    } else if (ev.type === 'round') {
      const sideLabel = ev.side === 0 ? from.label : to.label;
      setTicker(`Leg ${ev.round}: striking out from the ${sideLabel} side, ${ev.expanding} trails at once…`);
    }
  };

  // when the traveler demands a longer way, dig deeper and search wider —
  // and if the first cast comes up short, cast the net once more
  const minHops = state.requiredHops || 4;
  const stretch = Math.max(0, minHops - 4);

  let result = null, failure = null;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await findPath(from.id, to.id, {
        seed: state.seed ^ (attempt * 0x55555555),
        temperature: state.temperature + attempt * 0.2,
        avoidEdges: state.avoidEdges,
        avoidNodes: state.avoidNodes,
        minHops,
        maxRounds: 11 + stretch + attempt * 2,
        maxDepthPerSide: 6 + Math.ceil(stretch / 2) + attempt,
        nodeBudget: 560 + stretch * 90 + attempt * 220,
        onEvent,
        control: state.control,
      });
      if (!result || (r.path && (!result.path || r.path.hopCount > result.path.hopCount))) result = r;
      if (state.control.cancelled) break;
      if (result.path && result.path.hopCount >= minHops) break;
      if (attempt === 0 && minHops > 4) setTicker(`Still too direct for our taste — casting a wider net…`);
      else break;
    }
  } catch (e) {
    failure = e;
  }

  stopTicker();
  state.running = false;
  el.btnGo.disabled = false;
  el.btnGo.textContent = 'Set off the long way →';

  if (state.control.cancelled) return;

  if (failure) {
    console.error(failure);
    el.lost.hidden = false;
    $('lost-text').textContent = 'The atlas slammed shut mid-journey (a network or API hiccup). Catch your breath and try again.';
    el.lost.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  if (!result || !result.path) {
    el.expeditionTitle.textContent = 'The trail went cold.';
    el.lost.hidden = false;
    el.lost.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  state.lastResult = result;
  state.routeOptions = [result.path, ...(result.alternates || [])];
  state.activeRoute = result.path;
  await presentTale(result, from, to);

  // if a longer way was demanded but the atlas came up short, own up to it
  if (state.requiredHops && result.path.hopCount < state.requiredHops) {
    setTicker(`The scenic road ran out at ${result.path.hopCount} steps — no route of ${state.requiredHops} materialized, so here’s a different one instead.`);
  }
}

/* ── "take an even longer way": every click raises the bar ── */

async function rerun() {
  if (state.running) return;
  // remember the last route so the next one is genuinely different
  if (state.lastResult?.usedEdges) {
    for (const k of state.lastResult.usedEdges) state.avoidEdges.add(k);
  }
  state.temperature = Math.min(1.6, state.temperature + 0.2);
  const lastHops = state.activeRoute?.hopCount || state.lastResult?.path?.hopCount || 4;
  state.requiredHops = Math.min(12, Math.max(state.requiredHops || 0, lastHops + 1));
  setTicker(`Very well — nothing shorter than ${state.requiredHops} steps this time.`);
  go();
}

/* ── waypoint routing: force the journey through a chosen node ── */

async function runVia(waypointId) {
  if (state.running || !state.from || !state.to) return;
  if (waypointId === state.from.id || waypointId === state.to.id) return;
  hidePopover();

  const from = state.from, to = state.to;
  const wpLabel = state.constellation ? state.constellation.labelOf(waypointId) : waypointId;

  state.running = true;
  state.control = { cancelled: false };
  state.seed = Date.now() & 0x7fffffff;

  el.tale.hidden = true;
  el.lost.hidden = true;
  el.expedition.hidden = false;
  el.expeditionTitle.textContent = `Detour requested: ${from.label} → ${wpLabel} → ${to.label}…`;

  if (state.constellation) state.constellation.destroy();
  state.constellation = new Constellation(el.constellation);
  state.constellation.setOrigins(from.id, to.id);
  state.constellation.onNodeClick = showNodePopover;
  startTicker();

  const onEvent = (ev) => {
    const c = state.constellation;
    if (!c) return;
    if (ev.type === 'node') c.enqueue(ev);
    else if (ev.type === 'labels') c.enqueueLabels(ev.map);
    else if (ev.type === 'meet') c.markMeet(ev.id);
    else if (ev.type === 'progress') {
      el.statExplored.textContent = ev.explored.toLocaleString();
      el.statFrontier.textContent = ev.frontier.toLocaleString();
    }
  };
  const legOpts = {
    temperature: state.temperature,
    avoidNodes: state.avoidNodes,
    minHops: 2, maxRounds: 6, nodeBudget: 260,
    onEvent, control: state.control,
  };

  let leg1 = null, leg2 = null, failure = null;
  try {
    setTicker(`First leg: finding the scenic way to ${wpLabel}…`);
    leg1 = await findPath(from.id, waypointId, { ...legOpts, seed: state.seed });
    if (!state.control.cancelled) {
      setTicker(`Second leg: from ${wpLabel} onward to ${to.label}…`);
      leg2 = await findPath(waypointId, to.id, { ...legOpts, seed: state.seed ^ 0x9e3779b9 });
    }
  } catch (e) { failure = e; }

  stopTicker();
  state.running = false;
  if (state.control.cancelled) return;

  if (failure || !leg1?.path || !leg2?.path) {
    el.expeditionTitle.textContent = `No road through ${wpLabel} this time.`;
    el.lost.hidden = false;
    $('lost-text').textContent = `We couldn’t thread the journey through ${wpLabel} before the lanterns ran low. It may be a lonely corner of the atlas — try another waypoint.`;
    el.lost.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const nodes = [...leg1.path.nodes, ...leg2.path.nodes.slice(1)];
  const hops = [...leg1.path.hops, ...leg2.path.hops];
  trimCycles(nodes, hops);
  const path = { nodes, hops, hopCount: hops.length, score: 0, meetingNode: waypointId };

  const labels = new Map([...(leg1.labels || []), ...(leg2.labels || [])]);
  const result = {
    path, alternates: [], labels, shortest: null,
    usedEdges: computeUsedEdges(path),
    stats: {
      explored: leg1.stats.explored + leg2.stats.explored,
      discovered: leg1.stats.discovered + leg2.stats.discovered,
      meetings: leg1.stats.meetings + leg2.stats.meetings,
      rounds: leg1.stats.rounds + leg2.stats.rounds,
      seed: state.seed,
    },
  };
  state.lastResult = result;
  state.routeOptions = [path];
  state.activeRoute = path;
  await presentTale(result, from, to);
}

function resetToBoard() {
  if (state.control) state.control.cancelled = true;
  state.running = false;
  state.avoidEdges = new Set();
  state.avoidNodes = new Set();
  state.temperature = 0.7;
  state.requiredHops = null;
  state.lastPairKey = null;
  state.routeOptions = null;
  hidePopover();
  stopTicker();
  el.expedition.hidden = true;
  el.tale.hidden = true;
  el.lost.hidden = true;
  el.btnGo.disabled = false;
  el.btnGo.textContent = 'Set off the long way →';
  el.board.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.inputFrom.focus();
}

function showError(msg) {
  el.error.textContent = msg;
  el.error.hidden = false;
  el.btnGo.disabled = false;
  el.btnGo.textContent = 'Set off the long way →';
  state.running = false;
}

/* ─────────── ticker ─────────── */

let tickerIdx = 0;
function startTicker() {
  stopTicker();
  state.tickerTimer = setInterval(() => {
    setTicker(TICKER_LINES[tickerIdx++ % TICKER_LINES.length]);
  }, 3400);
}
function stopTicker() { clearInterval(state.tickerTimer); state.tickerTimer = null; }
function setTicker(msg) { el.ticker.textContent = msg; }

/* ─────────── the tale ─────────── */

async function presentTale(result, from, to) {
  const { path, shortest, stats } = result;
  setTicker('Route found. Writing it up…');

  const rng = makeRng(stats.seed ^ 0x5f3759df);

  // enrich: cards for every stop, labels for any unfamiliar relation
  const unknownProps = [...new Set(path.hops.map(h => h.prop))].filter(p => !PROP_META[p]);
  const [cards, extraPropLabels] = await Promise.all([
    getCards(path.nodes),
    getPropertyLabels(unknownProps),
  ]);

  const tale = narrate({ path, cards, propLabels: extraPropLabels, shortest, stats, rng });
  state.lastTale = tale;

  // constellation: dim the world, light the chain
  const labelMap = new Map(path.nodes.map(id => [id, cards.get(id)?.label || id]));
  state.constellation.highlightPath(path.nodes, labelMap);
  el.expeditionTitle.textContent = 'Route found. The scenic one.';

  // header
  el.taleTitle.textContent = tale.title;
  el.taleIntro.textContent = tale.intro;
  if (tale.shortcutLine) {
    el.shortcutTease.innerHTML = '';
    const b = document.createElement('b'); b.textContent = 'A confession. ';
    el.shortcutTease.append(b, tale.shortcutLine);
    el.shortcutTease.hidden = false;
  } else {
    el.shortcutTease.hidden = true;
  }

  // stops
  el.journeyStops.innerHTML = '';
  path.nodes.forEach((id, i) => {
    const card = cards.get(id);
    const li = document.createElement('li');
    li.className = 'stop' + (i === 0 ? ' departure' : '') + (i === path.nodes.length - 1 ? ' terminus' : '');
    li.style.animationDelay = `${Math.min(i * 0.45, 4)}s`;

    const hop = i > 0 ? path.hops[i - 1] : null;
    const relLabel = hop ? propLabel(hop.prop, extraPropLabels.get(hop.prop)) : null;
    const relArrow = hop ? (hop.dir === 'fwd' ? '→' : '←') : '';
    const hopSentence = i > 0 ? tale.hopSentences[i - 1] : (i === 0 ? 'Our story begins here.' : '');
    const isEndpoint = i === 0 || i === path.nodes.length - 1;

    li.innerHTML = `
      <div class="stop-card">
        <div class="stop-num">${i === 0 ? '⚑' : i}</div>
        <div class="stop-hop">
          <a class="hop-rel" target="_blank" rel="noopener"></a>
          ${isEndpoint ? '' : '<button class="stop-avoid" type="button">✕ avoid</button>'}
          <div class="hop-text"></div>
        </div>
        <div class="stop-body">
          <img class="stop-img" alt="" loading="lazy" hidden>
          <div>
            <h3 class="stop-name"><a target="_blank" rel="noopener"></a></h3>
            <p class="stop-desc"></p>
          </div>
        </div>
      </div>`;

    const relEl = li.querySelector('.hop-rel');
    if (hop) {
      relEl.textContent = `${relArrow} ${relLabel}`;
      // provenance: link straight to the underlying statement on Wikidata
      const subject = hop.dir === 'fwd' ? path.nodes[i - 1] : path.nodes[i];
      relEl.href = `${entityUrl(subject)}#${hop.prop}`;
      relEl.title = 'View the underlying claim on Wikidata'
        + (hop.dir === 'fwd' ? ' (stated on the previous stop)' : ' (stated on this stop)');
    } else {
      relEl.textContent = '⚑ departure';
      relEl.removeAttribute('href');
      relEl.title = 'where we set out from';
    }
    li.querySelector('.hop-text').textContent = hopSentence;

    const avoidBtn = li.querySelector('.stop-avoid');
    if (avoidBtn) {
      avoidBtn.title = `Ban ${card?.label || id} and chart a route around it`;
      avoidBtn.addEventListener('click', () => {
        state.avoidNodes.add(id);
        setTicker(`${card?.label || id} shall not be crossed. Recharting…`);
        go();
      });
    }

    // linked views: hovering a stop card pulses its node on the map
    li.addEventListener('mouseenter', () => state.constellation?.emphasize(id, true));
    li.addEventListener('mouseleave', () => state.constellation?.emphasize(id, false));

    const img = li.querySelector('.stop-img');
    if (card?.image) {
      img.src = card.image;
      img.alt = card.label;
      img.hidden = false;
      img.addEventListener('error', () => { img.hidden = true; scheduleRoad(); });
      img.addEventListener('load', () => scheduleRoad());
    }

    const a = li.querySelector('.stop-name a');
    a.textContent = card?.label || id;
    a.href = card?.url || `https://www.wikidata.org/wiki/${id}`;
    li.querySelector('.stop-desc').textContent = card?.description || 'a thing the world has not yet found words for';

    el.journeyStops.appendChild(li);
  });

  el.taleOutro.textContent = tale.outro;

  // stats chips
  el.taleStats.innerHTML = '';
  const chips = [
    [`${path.hopCount}`, 'steps taken'],
    [stats.explored.toLocaleString(), 'crossroads searched'],
    [stats.discovered.toLocaleString(), 'things encountered'],
    [stats.meetings.toLocaleString(), 'possible crossings'],
    [`#${stats.seed}`, 'expedition seed'],
  ];
  for (const [num, text] of chips) {
    const span = document.createElement('span');
    span.className = 'stat-chip';
    const b = document.createElement('b'); b.textContent = num;
    span.append(b, ` ${text}`);
    el.taleStats.appendChild(span);
  }

  renderRouteOptions();

  el.tale.hidden = false;
  setTicker('Done. Scroll for the tale — or click any dot on the map to poke the graph.');
  el.tale.scrollIntoView({ behavior: 'smooth', block: 'start' });

  scheduleRoad(true);
}

/* ── alternate roads: the beam found more than one story ── */

function renderRouteOptions() {
  const box = $('route-options');
  box.innerHTML = '';
  const options = state.routeOptions || [];
  if (options.length < 2) { box.hidden = true; return; }
  box.hidden = false;

  const labels = state.lastResult?.labels || new Map();
  const lead = document.createElement('span');
  lead.className = 'route-options-lead';
  lead.textContent = 'Other roads scouted: ';
  box.appendChild(lead);

  options.forEach((opt, idx) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'route-chip' + (opt === state.activeRoute ? ' active' : '');
    const via = labels.get(opt.meetingNode) || opt.meetingNode;
    chip.textContent = idx === 0 ? `the chosen road · ${opt.hopCount} steps` : `via ${via} · ${opt.hopCount} steps`;
    chip.addEventListener('click', () => {
      if (state.running || opt === state.activeRoute) return;
      state.activeRoute = opt;
      const resultLike = { ...state.lastResult, path: opt, usedEdges: computeUsedEdges(opt) };
      state.lastResult = resultLike;
      presentTale(resultLike, state.from, state.to);
    });
    box.appendChild(chip);
  });
}

/* ── detail-on-demand: the popover behind every dot ── */

let popEl = null;
function hidePopover() { if (popEl) { popEl.remove(); popEl = null; } }

document.addEventListener('click', (e) => {
  if (popEl && !popEl.contains(e.target)) hidePopover();
});

let lastPopPos = null;
async function showNodePopover(id) {
  const wrap = document.querySelector('.constellation-wrap');
  if (!wrap || !state.constellation) return;
  const prevPos = lastPopPos;
  hidePopover();

  // anchor to the node if it's on the map; otherwise keep the panel where it
  // was (so drilling neighbor→neighbor doesn't make it hop around)
  const pos = state.constellation.screenXY(id) || prevPos || { x: 60, y: 60 };
  const wrect = wrap.getBoundingClientRect();
  const left = Math.max(10, Math.min(wrect.width - 290, pos.x + 14));
  const top = Math.max(10, Math.min(wrect.height - 120, pos.y - 12));
  lastPopPos = { x: pos.x, y: pos.y };
  popEl = document.createElement('div');
  popEl.className = 'kg-pop';
  popEl.style.left = left + 'px';
  popEl.style.top = top + 'px';
  popEl.innerHTML = `<button class="kg-pop-close" aria-label="Close" type="button">×</button>
    <div class="kg-pop-body"><em>consulting the atlas…</em></div>`;
  popEl.querySelector('.kg-pop-close').addEventListener('click', hidePopover);
  popEl.addEventListener('click', e => e.stopPropagation());
  wrap.appendChild(popEl);

  let card = null;
  try { card = (await getCards([id])).get(id); } catch { /* leave the mystery */ }
  if (!popEl) return; // closed while we were reading

  const body = popEl.querySelector('.kg-pop-body');
  body.innerHTML = '';
  if (card?.image) {
    const im = document.createElement('img');
    im.src = card.image; im.alt = ''; im.className = 'kg-pop-img';
    body.appendChild(im);
  }
  const name = document.createElement('div');
  name.className = 'kg-pop-name';
  const a = document.createElement('a');
  a.href = card?.url || entityUrl(id);
  a.target = '_blank'; a.rel = 'noopener';
  a.textContent = card?.label || id;
  name.appendChild(a);
  body.appendChild(name);

  const desc = document.createElement('div');
  desc.className = 'kg-pop-desc';
  desc.textContent = card?.description || 'no description — mysterious';
  body.appendChild(desc);

  const ent = { id, label: card?.label || id, description: card?.description || '' };
  const row = document.createElement('div');
  row.className = 'kg-pop-actions';
  const mk = (txt, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = txt; b.title = title;
    b.addEventListener('click', fn);
    row.appendChild(b);
  };
  if (id !== state.from?.id && id !== state.to?.id) {
    mk('☞ route through here', 'Force the journey through this stop', () => runVia(id));
    mk('✕ ban', 'Never route through this again, then rechart', () => {
      state.avoidNodes.add(id);
      hidePopover();
      setTicker(`${ent.label} shall not be crossed. Recharting…`);
      go();
    });
  }
  mk('⚑ depart from here', 'Make this the departure point', () => setEndpoint('from', ent));
  mk('⚓ journey to here', 'Make this the destination', () => setEndpoint('to', ent));
  const wikiBtn = document.createElement('a');
  wikiBtn.className = 'kg-pop-wiki';
  wikiBtn.href = card?.url || entityUrl(id);
  wikiBtn.target = '_blank'; wikiBtn.rel = 'noopener';
  wikiBtn.textContent = '↗ read more';
  wikiBtn.title = 'Open on Wikipedia / Wikidata';
  row.appendChild(wikiBtn);
  body.appendChild(row);

  // live graph exploration: this node's most interesting real connections
  const neigh = document.createElement('div');
  neigh.className = 'kg-pop-neigh';
  neigh.innerHTML = '<div class="kg-pop-neigh-head">Wander the graph from here…</div><div class="kg-pop-neigh-list"><em>looking around…</em></div>';
  body.appendChild(neigh);

  try {
    const links = await getInterestingNeighbors(id, propWeight, PRUNE, 7);
    if (!popEl) return;
    const list = neigh.querySelector('.kg-pop-neigh-list');
    list.innerHTML = '';
    if (!links.length) { neigh.remove(); return; }
    for (const lk of links) {
      const rel = propLabel(lk.prop, lk.rel);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'kg-neigh';
      item.innerHTML = `<span class="kg-neigh-rel">${lk.dir === 'fwd' ? '→' : '←'} ${rel}</span><span class="kg-neigh-name"></span>`;
      item.querySelector('.kg-neigh-name').textContent = lk.label;
      item.title = `Inspect ${lk.label}`;
      item.addEventListener('click', () => showNodePopover(lk.target));
      list.appendChild(item);
    }
  } catch {
    const list = neigh.querySelector('.kg-pop-neigh-list');
    if (list) list.innerHTML = '<em>the trail is quiet here</em>';
  }
}

function setEndpoint(key, ent) {
  state[key] = ent;
  const input = key === 'from' ? el.inputFrom : el.inputTo;
  const picked = key === 'from' ? el.pickedFrom : el.pickedTo;
  input.value = ent.label;
  picked.hidden = false;
  picked.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = ent.label;
  picked.append(b, ent.description ? ` — ${ent.description}` : ' — locked in');
  hidePopover();
  go();
}

/* road drawing: after layout & images settle, and on resize */
let roadTimer = null;
let roadAnimated = false;
function scheduleRoad(fresh = false) {
  if (fresh) roadAnimated = false;
  clearTimeout(roadTimer);
  roadTimer = setTimeout(() => {
    if (el.tale.hidden) return;
    const dots = [...el.journeyStops.querySelectorAll('.stop-num')];
    if (window.innerWidth > 720 && dots.length >= 2) {
      drawRoad(el.journeyRoad, el.journey, dots, !roadAnimated);
      roadAnimated = true;
    }
  }, fresh ? 650 : 350);
}
window.addEventListener('resize', () => scheduleRoad());

/* ─────────── arrivals by shared link ─────────── */

(function initFromUrl() {
  const p = new URLSearchParams(location.search);
  const from = p.get('from'), to = p.get('to');
  if (!from || !to) return;
  state.from = { id: from, label: p.get('fl') || from, description: '' };
  state.to = { id: to, label: p.get('tl') || to, description: '' };
  el.inputFrom.value = state.from.label;
  el.inputTo.value = state.to.label;
  const seed = p.get('seed');
  go(seed != null ? Number(seed) : null);
})();
