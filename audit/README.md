# Executable reproducers for `../AUDIT.md`

Each `fN-*.js` script drives the real application in Chromium via Playwright,
prints the observed evidence, and exits `0` when the finding reproduces and `1`
when it does not.

## Setup

```bash
cd audit
npm install
node f1-grid-layer-collision.js       # or: npm run all
```

`CHROME_PATH` overrides the Chromium binary
(default `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). `f2` also has a
pure-Python variant that needs no browser: `python3 f2-kpi-arithmetic.py`.

## What the harness touches

`_serve.js` serves the repository root unmodified on `127.0.0.1:8791`.
`_harness.js` intercepts only the third-party hosts the app loads from, because
they are unreachable from a sandboxed network:

| Request | Substituted with |
|---|---|
| `unpkg.com/maplibre-gl@4.7.1/…` | the local `node_modules` copy of the same pinned version |
| `basemaps.cartocdn.com/…` | a 1×1 transparent PNG |
| `openinframap.org/tiles/…` | HTTP 204 |
| `fonts.googleapis.com`, `demotiles.maplibre.org` | empty |

No file in `index.html`, `app.js`, `style.css` or `data/` is altered. Two
scripts deliberately substitute one layer file to model a specific upstream
condition, and say so in their header:

* **`f5-xss.js`** — serves a layer file carrying a hostile `voltage_kv` /
  `status` / `source_url`, modelling a malicious community data contribution.
* **`f7-fetch-failure.js`** — returns HTTP 503 for `power-plants.geojson` only.

`window.__map` is exposed by an `addInitScript` that wraps `maplibregl.Map`
before the page's own scripts run; the app keeps its map instance inside an
IIFE, and this reads it without modifying `app.js`.

## Findings

| Script | Finding |
|---|---|
| `f1-grid-layer-collision.js` | Interconnectors overwritten by planned corridors; toggles cross-wired |
| `f2-kpi-arithmetic.js` / `.py` | Renewables share understated 23 % vs 39 % |
| `f3-fuel-colour.js` | 16/42 plants drawn grey; popup badge disagrees (canvas pixel readback) |
| `f4-status-vocabulary.js` | `lyr-power-halo` matches 0 features; unstyled `under_construction` pill |
| `f5-xss.js` | Two confirmed HTML-injection sinks, one latent `javascript:` href |
| `f6-hover-dim.js` | Hover-dim no-op on industrial + digital (`promoteId` id-space mismatch) |
| `f7-fetch-failure.js` | A 503 renders as "0.0 GW · source: ONEE 2025" |
| `f8-inert-hv-lines.js` | 947 HV lines inert; clicks swallowed, stale popup persists |
| `f9-listener-leak.js` | Listener count grows linearly per theme toggle |
| `f10-methodology-links.js` | Modal cites a wrong path and two 404 documents |

## Notes on flakiness

`f3` reads pixels from a software-rasterised WebGL canvas, and `f1`/`f5`/`f8`
scan the canvas for a screen point that hits a line layer. Both wait for tile
and render settling, but if a run reports "NOT reproduced", re-run once before
concluding the behaviour has changed.
