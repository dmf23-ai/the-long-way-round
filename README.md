# The Long Way Round

**The surprising chain between any two things.** · **Live at [thelongwayround.net](https://thelongwayround.net)**

Give it two entities — *Medicaid* and *the banjo*, say — and The Long Way Round finds the most **interesting** (deliberately not shortest) path between them through the live Wikidata knowledge graph, draws the search as two constellations racing to meet, then narrates the journey stop by stop like a dispatch from a slightly unhinged travel writer.

Whimsy is the whole point. Every link is a real, sourced statement.

## Run it

Any static file server will do — there is no build step:

```
npx http-server -p 4517 -c-1 .
```

Then open http://localhost:4517. (Internet required: the graph is queried live.)

## How the scenic route is found

The engine is a **bidirectional stochastic beam search** over Wikidata's ~100M entities, queried in real time from the browser (batched `wbgetentities`, no backend, no API key):

- **Property informativeness prior** — every relation type carries a hand-tuned IDF-like weight: taxonomic glue (*instance of*, *country*, *gender*) is penalized or pruned; high-surprise relations (*named after*, *inspired by*, *discoverer or inventor*, *present in work*) are rewarded. Pure wormholes (*described by source*, *copyright status*, *is metaclass for*) are pruned outright.
- **Hub damping + forbidden intermediates** — degree-based penalties keep routes off the interstate, and a small set of ultra-generic concepts ("human", "organization", "education") may never serve as through-stations at all: *"X is a human, and so is Y"* explains nothing.
- **Concreteness prior** — stops with a face (an image, a birthdate, coordinates, an inception) make satisfying stories; nodes that are classes of things tax every route through them.
- **Endpoints look both ways** — the walk follows *outgoing* statements (which keeps mega-hubs tame), but an abstract endpoint's liveliest neighbors are the people, works and events whose own pages point *at* it, so both endpoints also sample their incoming statements via a live SPARQL query. This is what turns "…teaching → learning → homeschooling" into "…Lake View Cemetery → Denise Levertov, who was homeschooled."
- **Launch and land on specifics** — generic relations are penalized extra hard on the first hop out of either endpoint.
- **Diversity pressure** — repeating a relation is penalized, so no ten-rung taxonomy ladders; taxonomic same-relation pivots are rejected at the join.
- **Gumbel-perturbed beam** — edge scores get Gumbel noise before top-k selection (the "Gumbel top-k" trick), so each run samples a fresh near-optimal scenic route. Runs are seeded and replayable; share links carry the seed.
- **Meet-in-the-middle, then rerank** — joined paths are re-scored with a length-shaping term preferring 5–8 hops, then the finalists' labels are fetched and any route where two stops wear the same name is rejected (retrieve-then-rerank). If a dull direct shortcut exists, it is confessed to separately.

The narration is assembled from direction-aware templates per relation, so the prose never lies about which way a claim points.

## Poking the graph

The map is a real, interactive knowledge-graph view (detail-on-demand, in the KG-visualization sense): click any dot to inspect it — make it the departure or destination, **ban it** ("shall not be crossed"), or **force the route through it** (two-leg waypoint search with cycle trimming). Stop cards offer per-stop "avoid" buttons, hovering a card pulses its node on the map, alternate roads the beam scouted are one click away, and every relation chip links to the underlying statement on Wikidata — provenance all the way down.

## Files

| file | role |
|---|---|
| `js/wikidata.js` | batched, cached Wikidata API client |
| `js/scoring.js` | the interestingness model (property weights, hub damping, Gumbel, seeded RNG) |
| `js/pathfinder.js` | bidirectional stochastic beam search + meet-in-the-middle |
| `js/narrate.js` | direction-aware storytelling templates |
| `js/viz.js` | live force-directed constellation + winding-road renderer (D3) |
| `js/app.js` | UI orchestration |
| `assets/generated/` | AI-generated artwork (decorative only — see manifest) |

## Credits

Data: [Wikidata](https://www.wikidata.org), CC0. Artwork: AI-generated, decorative only (manifest in `assets/generated/README.md`). Fonts: Fraunces & Newsreader.
