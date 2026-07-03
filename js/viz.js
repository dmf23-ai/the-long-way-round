/* ══════════════════════════════════════════════════════════════
   viz.js — two visual instruments:

   1. Constellation — a live force-directed map of the search:
      two families of nodes (ochre = departure side, teal =
      destination side) growing toward each other, labels drifting
      in as the searcher learns what it has found. When the route
      is chosen, everything else dims and the chain lights up.

   2. Journey road — the winding dotted route drawn through the
      stop cards of the final tale, with a little traveler dot
      that walks it once.
   ══════════════════════════════════════════════════════════════ */

/* global d3 */

const MAX_DISPLAY = 720;

export class Constellation {
  constructor(svgEl) {
    this.svg = d3.select(svgEl);
    this.svg.selectAll('*').remove();
    this.zoomG = this.svg.append('g');
    this.linkG = this.zoomG.append('g');
    this.pathLinkG = this.zoomG.append('g');
    this.nodeG = this.zoomG.append('g');
    this.labelG = this.zoomG.append('g');

    this.nodes = [];
    this.links = [];
    this.byId = new Map();
    this.queue = [];
    this.labelQueue = new Map();
    this.allLabels = new Map();   // every label we ever learn, for tooltips
    this.labelCount = 0;
    this.highlighted = false;
    this.onNodeClick = null;      // detail-on-demand hook, wired by the app

    const rect = svgEl.getBoundingClientRect();
    this.w = rect.width || 900;
    this.h = rect.height || 460;

    this.zoom = d3.zoom().scaleExtent([0.35, 4])
      .on('zoom', (ev) => this.zoomG.attr('transform', ev.transform));
    this.svg.call(this.zoom);

    this.sim = d3.forceSimulation(this.nodes)
      .force('link', d3.forceLink(this.links).id(d => d.id).distance(34).strength(0.32))
      .force('charge', d3.forceManyBody().strength(-40).distanceMax(300))
      .force('x', d3.forceX(d => d.side === 0 ? this.w * 0.24 : this.w * 0.76).strength(0.04))
      .force('y', d3.forceY(this.h / 2).strength(0.055))
      .force('collide', d3.forceCollide(d => (d._showLabel ? 15 : 7)))
      .alphaDecay(0.014)
      .on('tick', () => this._tick());

    this.tickCount = 0;
    this.flushTimer = setInterval(() => this._flush(), 260);
    this.zoom.on('zoom.relabel', () => { this._relabelSoon(); });
  }

  destroy() {
    clearInterval(this.flushTimer);
    this.sim.stop();
  }

  setOrigins(fromId, toId) {
    this._addNode({ id: fromId, side: 0, origin: true, fx: this.w * 0.10, fy: this.h / 2 });
    this._addNode({ id: toId, side: 1, origin: true, fx: this.w * 0.90, fy: this.h / 2 });
    this._flush(true);
  }

  enqueue(ev) { this.queue.push(ev); }

  enqueueLabels(map) {
    for (const [id, label] of map) {
      this.labelQueue.set(id, label);
      this.allLabels.set(id, label);
    }
  }

  labelOf(id) {
    const n = this.byId.get(id);
    return (n && n.label) || this.allLabels.get(id) || id;
  }

  /** Screen-space position of a node (for anchoring popovers). */
  screenXY(id) {
    const n = this.byId.get(id);
    if (!n) return null;
    const t = d3.zoomTransform(this.svg.node());
    const [x, y] = t.apply([n.x, n.y]);
    return { x, y };
  }

  /** Pulse-highlight a node when its stop card is hovered. */
  emphasize(id, on) {
    const n = this.byId.get(id);
    if (!n || !this.nodeSel) return;
    this.nodeSel.filter(d => d.id === id)
      .transition().duration(180)
      .attr('r', on ? 14 : (n.onPath ? 9 : (n.origin ? 8 : 3)));
  }

  _addNode({ id, side, origin = false, fx = null, fy = null, parent = null }) {
    if (this.byId.has(id)) return this.byId.get(id);
    if (this.nodes.length >= MAX_DISPLAY && !origin) return null;
    const p = parent ? this.byId.get(parent) : null;
    const jitter = () => (Math.random() - 0.5) * 40;
    const node = {
      id, side, origin, degree: 0,
      x: p ? p.x + jitter() : (side === 0 ? this.w * 0.2 : this.w * 0.8) + jitter(),
      y: p ? p.y + jitter() : this.h / 2 + jitter(),
      fx, fy,
    };
    this.nodes.push(node);
    this.byId.set(id, node);
    if (p) { this.links.push({ source: node, target: p }); node.degree++; p.degree++; }
    return node;
  }

  _flush(force = false) {
    if (this.highlighted && !force) { this.queue.length = 0; this.labelQueue.clear(); return; }
    let changed = false;
    const batch = this.queue.splice(0, 260);
    for (const ev of batch) {
      if (this._addNode(ev)) changed = true;
    }
    if (this.labelQueue.size) {
      for (const [id, label] of this.labelQueue) {
        const n = this.byId.get(id);
        if (n && !n.label) { n.label = label; changed = true; }
      }
      this.labelQueue.clear();
    }
    if (!changed) return;

    this._render();
    this._relabel();
    this.sim.nodes(this.nodes);
    this.sim.force('link').links(this.links);
    this.sim.alpha(Math.max(this.sim.alpha(), 0.45)).restart();
  }

  _render() {
    const hl = this.highlighted;
    this.linkSel = this.linkG.selectAll('line').data(this.links)
      .join('line').attr('class', 'c-link').classed('dimmed', hl);

    this.nodeSel = this.nodeG.selectAll('circle').data(this.nodes, d => d.id)
      .join(enter => enter.append('circle')
        .attr('r', 0)
        .call(s => s.transition().duration(500).attr('r', d => d.origin ? 8 : 3))
        .call(s => s.append('title'))
        .on('click', (ev, d) => { ev.stopPropagation(); if (this.onNodeClick) this.onNodeClick(d.id); }))
      .attr('class', d => `c-node side-${d.side}${d.meet ? ' meet' : ''}${d.onPath ? ' path-node' : ''}`)
      .classed('dimmed', d => hl && !d.onPath);
    this.nodeSel.select('title').text(d => this.labelOf(d.id));
    this._renderLabels();
  }

  _renderLabels() {
    const hl = this.highlighted;
    this.labelSel = this.labelG.selectAll('g.c-label-g')
      .data(this.nodes.filter(d => d._showLabel && d.label), d => d.id)
      .join(enter => {
        const g = enter.append('g').attr('class', 'c-label-g');
        g.append('text').attr('class', 'c-label-halo');
        g.append('text').attr('class', 'c-label-fg');
        return g;
      });
    this.labelSel.select('.c-label-halo')
      .attr('class', d => 'c-label-halo' + (d.onPath ? ' path-label' : ''))
      .text(d => d.label);
    this.labelSel.select('.c-label-fg')
      .attr('class', d => 'c-label-fg' + (d.onPath ? ' path-label' : ''))
      .classed('dimmed', d => hl && !d.onPath)
      .text(d => d.label);
    this._positionLabels();
  }

  /* Greedy declutter: label the most important nodes whose text boxes
     don't collide in screen space — origins and the chosen chain first,
     then the best-connected hubs, capped so the map stays legible. */
  _relabel() {
    if (!this.nodes.length) return;
    const t = d3.zoomTransform(this.svg.node());
    const importance = d => d.origin ? 1e9 : d.onPath ? 1e8 : d.meet ? 1e6 : (d.degree || 0);
    const cands = this.nodes.filter(d => d.label).sort((a, b) => importance(b) - importance(a));
    const cap = this.highlighted ? 999 : 20;
    const placed = [];
    let count = 0;
    for (const d of cands) {
      d._showLabel = false;
      if (this.highlighted && !d.onPath) continue;
      if (!this.highlighted && count >= cap) continue;
      const sx = t.applyX(d.x), sy = t.applyY(d.y);
      const w = d.label.length * 6.6 + 10;
      // near the right edge, grow the label leftward so it doesn't clip
      d._anchorEnd = sx > this.w * 0.72;
      const box = { x: d._anchorEnd ? sx - 6 - w : sx + 6, y: sy - 18, w, h: 16 };
      let ok = true;
      for (const p of placed) {
        if (box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y) { ok = false; break; }
      }
      if (ok) { d._showLabel = true; placed.push(box); count++; }
    }
    this.sim.force('collide').initialize(this.nodes);
    this._renderLabels();
  }

  _relabelSoon() {
    clearTimeout(this._relabelT);
    this._relabelT = setTimeout(() => this._relabel(), 120);
  }

  markMeet(id) {
    const n = this.byId.get(id);
    if (n) { n.meet = true; this._render(); }
  }

  _positionLabels() {
    if (!this.labelSel) return;
    this.labelSel.attr('transform', d => `translate(${d.x + (d._anchorEnd ? -6 : 6)},${d.y - 6})`);
    this.labelSel.selectAll('text').attr('text-anchor', d => d._anchorEnd ? 'end' : 'start');
  }

  _tick() {
    if (this.nodeSel) this.nodeSel.attr('cx', d => d.x).attr('cy', d => d.y);
    if (this.linkSel) this.linkSel
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    this._positionLabels();
    if (this.pathLinkSel) this.pathLinkSel
      .attr('x1', d => d[0].x).attr('y1', d => d[0].y)
      .attr('x2', d => d[1].x).attr('y2', d => d[1].y);
    // periodically re-declutter as the layout drifts
    if ((++this.tickCount % 14) === 0) this._relabel();
  }

  /** Light up the chosen route; dim the rest of the explored world. */
  highlightPath(nodeIds, labels) {
    this.highlighted = true;
    const set = new Set(nodeIds);
    for (const n of this.nodes) {
      n.onPath = set.has(n.id);
      if (n.onPath) {
        n.label = labels.get(n.id) || n.label || n.id;
        if (!n.origin) { n.fx = null; n.fy = null; }
      }
    }
    // make sure every path node exists even if display was capped
    let prev = null;
    for (const id of nodeIds) {
      let n = this.byId.get(id);
      if (!n) {
        n = this._addNode({ id, side: 0, origin: true }); // origin flag bypasses the cap
        n.origin = false;
        n.label = labels.get(id) || id;
      }
      prev = n;
    }

    const pathPairs = [];
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const a = this.byId.get(nodeIds[i]);
      const b = this.byId.get(nodeIds[i + 1]);
      if (a && b) pathPairs.push([a, b]);
    }
    this.pathLinkSel = this.pathLinkG.selectAll('line').data(pathPairs)
      .join('line').attr('class', 'c-link path-link');

    this._relabel();
    this._render();
    this.nodeSel
      .attr('r', d => d.onPath ? 9 : (d.origin ? 8 : 3))
      .classed('dimmed', d => !d.onPath);
    this.linkSel.classed('dimmed', true);

    // straighten the chain a little: gentle ordering force along x
    const n = nodeIds.length;
    nodeIds.forEach((id, i) => {
      const node = this.byId.get(id);
      if (node) {
        node.targetX = this.w * (0.08 + 0.84 * (i / Math.max(1, n - 1)));
      }
    });
    this.sim.force('x', d3.forceX(d => d.onPath ? d.targetX : (d.side === 0 ? this.w * 0.26 : this.w * 0.74))
      .strength(d => d.onPath ? 0.28 : 0.02));
    this.sim.force('y', d3.forceY(this.h / 2).strength(d => d.onPath ? 0.12 : 0.04));
    this.sim.alpha(0.6).restart();

    // ease the camera back to a comfortable fit
    this.svg.transition().duration(900)
      .call(this.zoom.transform, d3.zoomIdentity);
  }
}

/* ══════════════ journey road ══════════════ */

/**
 * Draw the dotted winding road through the stop markers,
 * then send a little traveler dot down it once.
 */
export function drawRoad(svgEl, containerEl, dotEls, animate = true) {
  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();
  const crect = containerEl.getBoundingClientRect();
  svg.attr('viewBox', `0 0 ${crect.width} ${crect.height}`);

  const pts = dotEls.map(el => {
    const r = el.getBoundingClientRect();
    return [r.left - crect.left + r.width / 2, r.top - crect.top + r.height / 2];
  });
  if (pts.length < 2) return;

  const line = d3.line().curve(d3.curveCatmullRom.alpha(0.9));
  const d = line(pts);

  svg.append('path').attr('class', 'road-under').attr('d', d);
  const road = svg.append('path').attr('class', 'road-path').attr('d', d);

  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const traveler = svg.append('circle').attr('class', 'road-traveler').attr('r', 7);
  const total = road.node().getTotalLength();
  const dur = Math.min(9000, 1400 + total * 3.5);
  const t0 = performance.now();
  function step(now) {
    const t = Math.min(1, (now - t0) / dur);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const p = road.node().getPointAtLength(ease * total);
    traveler.attr('cx', p.x).attr('cy', p.y);
    if (t < 1) requestAnimationFrame(step);
    else traveler.transition().duration(700).attr('r', 0).remove();
  }
  requestAnimationFrame(step);
}
