# Reliability, correctness & security audit — v1.6 (`9525676`)

Ten reproducible defects, verified by executing the application in a real browser
(Chromium + MapLibre GL 4.7.1) against the committed data files. Every finding
below was observed at runtime; hypotheses that could not be reproduced were
discarded and are listed at the end.

**Reproducing:** see [`audit/README.md`](audit/README.md). All findings are
verified by scripts in `audit/`, which serve the app unmodified and intercept
only the blocked third-party CDN/tile hosts.

| # | Finding | Severity |
|---|---------|----------|
| [1](#f1) | Interconnector layer silently overwritten by planned corridors; grid toggles cross-wired | High |
| [2](#f2) | "Renewables share" understated by 16 points — 2,202 MW of solar dropped | High |
| [3](#f3) | 16 of 42 plants render as unclassified grey; popup contradicts the map | High |
| [4](#f4) | `status` vocabulary mismatch — 3,820 MW of unbuilt capacity shown as built | High |
| [5](#f5) | Stored XSS via two unescaped GeoJSON fields | High |
| [6](#f6) | Hover-dim is a silent no-op on the industrial and digital layers | Medium |
| [7](#f7) | A failed data fetch renders "0.0 GW" as a sourced figure | Medium |
| [8](#f8) | 947 HV lines are inert and swallow clicks, leaving a stale popup open | Medium |
| [9](#f9) | Event-listener leak on every theme toggle | Low |
| [10](#f10) | Methodology modal cites a wrong path and two 404 documents | Low |

---

<a name="f1"></a>
## F1 — Interconnector layer is silently overwritten by planned corridors; the two grid toggles are cross-wired

**Severity: High** (data integrity / provenance — a whole advertised layer is absent)

`buildLineLayer(dataLayerId, fc)` accepts a layer id but never uses it. It
hard-codes one source (`src-grid`) and one set of five MapLibre layer ids
(`app.js:536-538`). `buildMapLayers()` calls it twice — first for
`interconnectors`, then for `planned-corridors` (`app.js:493-498`) — so the
second call removes the first call's layers and `addOrReplace()`s the shared
source with the planned-corridor data. The interconnector GeoJSON is fetched,
counted in the sidebar, and then discarded.

`layersFor()` (`app.js:363-366`) has the mirror-image defect: both data layers
resolve to `kind === "grid"` and therefore to the *same* five layer ids, so
`applyLayerVisibility()` cannot address them independently.

**Reproduce** — `node audit/f1-grid-layer-collision.js`

**Input:** default load, Morocco, no interaction.

**Expected:** `src-grid` carries all 11 line features (3 interconnectors +
8 planned corridors); un-checking "Grid — Interconnectors" hides only the
interconnectors.

**Actual:**

```
src-grid feature count: 8
src-grid contents:      HVDC Sahara corridor …, Spain–Morocco Interconnector III (planned…),
                        Xlinks…, 225 kV line (WBG…) ×2, 400 kV line (WBG…) ×3
queryRenderedFeatures(lyr-grid-*) → 5 distinct names, 0 of them interconnectors

sidebar: "Grid — Interconnectors (HV, operational / idle)   3"   ← counted but never drawn

after clicking ONLY the "interconnectors" checkbox off:
  lyr-grid-hv=none  lyr-grid-mv=none  lyr-grid-lv=none  lyr-grid-planned=none  lyr-grid-idle=none
  planned-corridors checkbox still reports checked: true
```

Spain–Morocco Interconnector I (700 MW, 1997), Interconnector II and the idle
Algeria–Morocco link are absent from the map. The `lyr-grid-hv`, `lyr-grid-mv`,
`lyr-grid-lv` and `lyr-grid-idle` layers exist but match zero features, because
every surviving feature has `status: "planned"`. The sidebar count of `3` and
the "operational / idle" layer title assert data that is never rendered.

The toggle coupling is severe enough to have broken our own test harness: an
early reproducer hid the planned corridors by un-checking *interconnectors*.

**Root cause:** two distinct data layers share one MapLibre source/layer
namespace. `buildLineLayer` needs to derive `srcId`/layer ids from
`dataLayerId`, and `layersFor()` must return per-data-layer ids.

---

<a name="f2"></a>
## F2 — "Renewables share" is understated by 16 percentage points

**Severity: High** (incorrect calculation on the headline KPI)

`renderKPIs()` (`app.js:326-330`) selects renewables with
`["solar","wind","hydro"].includes(f.properties.fuel_type)`. The dataset's
taxonomy is `solar_pv` and `solar_csp` — the literal string `"solar"` appears
in zero of 42 features. Every solar plant is therefore excluded from the
numerator while remaining in the denominator.

**Reproduce** — `node audit/f2-kpi-arithmetic.js` (browser) and
`python3 audit/f2-kpi-arithmetic.py` (arithmetic from the raw files)

**Input:** `data/morocco/power-plants.geojson` as committed.

| | |
|---|---|
| Denominator (all 42 plants) | 13,627 MW |
| Numerator as coded (`solar`/`wind`/`hydro`) | 3,082 MW → **23 %  ← displayed** |
| Numerator including `solar_pv` + `solar_csp` | 5,284 MW → **39 %** |
| Solar capacity silently dropped | **2,202 MW** across 10 plants |

Observed panel text: `RENEWABLES SHARE* | 23%`.

Two compounding errors in the same expression:

* `fuel_type: "pumped_storage"` (995 MW, 3 plants) is counted in the
  denominator as generation. Pumped storage is storage — it is a net consumer
  of energy and inflates the denominator.
* The denominator mixes 3,820 MW of `planned` / `under_construction` capacity
  with 9,807 MW operating, under a panel headed "Snapshot · source: ONEE 2025".
  Operational-only, with the taxonomy fixed, the share is 32 %.

So the displayed 23 % is not any of the three defensible figures (39 %, 32 %,
or a storage-excluded variant). The `*` on the label has no footnote anywhere
in the UI, and the methodology modal's "Limits" list discloses only that
capacity factors are not applied — it does not disclose that unbuilt capacity
is included, which is a discrepancy between stated methodology and actual
computation. `Tracked capacity 13.6 GW` is overstated by the same 3,820 MW.

---

<a name="f3"></a>
## F3 — 16 of 42 plants render as unclassified grey, and the popup contradicts the map

**Severity: High** (misleading output; map and detail view disagree for the same feature)

The `circle-color` `match` on `lyr-power-points` (`app.js:634-644`) enumerates
`solar`, `wind`, `hydro`, `coal`, `gas`, `oil` with a `#888` fallback — the same
stale taxonomy as F2. Meanwhile `openPointPopup()` computes its badge dot as
`FUEL_COLOR[p.fuel_type] || FUEL_COLOR.solar` (`app.js:976`), so an unmatched
fuel type falls back to **solar amber** in the popup while the map draws grey.

**Reproduce** — `node audit/f3-fuel-colour.js` (reads back canvas pixels)

**Input:** zoom 11 on each plant; `gl.readPixels` at the projected coordinate.

| Plant | `fuel_type` | Rendered RGB | Intended |
|---|---|---|---|
| Noor I (Ouarzazate CSP) | `solar_csp` | `136,136,136` | `#F59E0B` = `245,158,11` |
| Noor IV (Ouarzazate PV) | `solar_pv` | `136,136,136` | `#F59E0B` |
| Tangier I Wind Farm | `wind` | `13,148,136` ✓ | `#0D9488` |
| Jerada Coal Plant | `coal` | `139,127,114` ✓ | `#8B7F72` |

Unmatched: all 10 solar plants (2,202 MW), `gas_iscc`, `gas_ccgt`, `hfo`,
and 3 × `pumped_storage` — **16 features / 6,271 MW** drawn as "unknown fuel".
The footer legend advertises amber/teal/blue/orange/violet swatches; the amber
solar swatch corresponds to nothing on the map.

The map/popup disagreement is directly observable: Noor I is a grey dot whose
popup badge dot is amber. For `pumped_storage` the popup asserts solar amber
for a hydro asset.

---

<a name="f4"></a>
## F4 — `status` vocabulary mismatch: 3,820 MW of unbuilt capacity is indistinguishable from operating plants

**Severity: High** (misleading output; the only cue separating pipeline from reality is dead)

`lyr-power-halo` exists to mark non-operational plants. Its filter
(`app.js:621`) is `["in",["get","status"],["literal",["announced","construction"]]]`.
The power dataset uses `operational` (34), `under_construction` (3) and
`planned` (5) — neither filter value occurs.

**Reproduce** — `node audit/f4-status-vocabulary.js`

```
data statuses:   { operational: 34, under_construction: 3, planned: 5 }
halo filter:     ["all",["!",["has","point_count"]],
                  ["in",["get","status"],["literal",["announced","construction"]]]]
queryRenderedFeatures(lyr-power-halo) → 0     ← matches nothing, at any zoom
queryRenderedFeatures(lyr-power-points) → 13  (same viewport)
```

All 8 non-operational plants — including Nador West Med (1,320 MW coal, under
construction) and Sebkhate Tah (500 MW PV, planned) — render identically to
operating plants. Nothing on the map distinguishes 9.8 GW of existing
generation from 3.8 GW that does not exist yet. The equivalent halo on the
digital layer works, because `digital.geojson` happens to use
`announced`/`construction`: the code is written to one vocabulary and the power
data to another.

**Same root cause, second symptom** — `style.css:365-374` defines
`.status-pill` variants for `operational`, `construction`, `announced`,
`planned` and `idle`, but not `under_construction`. Clicking Nador West Med:

```
class="status-pill under_construction"
background: rgba(0, 0, 0, 0)      ← no fill
color:      rgb(241, 239, 233)    ← inherited body text, not a status colour
dot background: rgba(0, 0, 0, 0)  ← the status dot is invisible
```

The pill reads `under_construction` in default body text with an invisible dot,
i.e. the one place the distinction survives is also unstyled.

---

<a name="f5"></a>
## F5 — Stored XSS: two unescaped interpolations in the tooltip and popup builders

**Severity: High** (script execution on the app origin from layer data)

Both renderers escape most fields with `escapeHtml()` — `name`, `source`,
`sector`, `precision` are all escaped — but two fields are interpolated raw
into `innerHTML`:

1. **`voltage_kv`, text context.** `showLineTooltip()` `app.js:930`
   (`${p.voltage_kv} kV · …`) and `openLinePopup()` `app.js:1008,1011`.
2. **`status`, unquoted-by-the-author attribute context.**
   `class="status-pill ${p.status || 'operational'}"` in `openPointPopup()`
   `app.js:985` and `openLinePopup()` `app.js:1009`.

**Reproduce** — `node audit/f5-xss.js`. The script serves the app unmodified and
substitutes one layer file, simulating a malicious or compromised data
contribution. This is squarely in the threat model: the UI carries "Contribute
data ↗" / "Report a data error" links and the README-level promise that layers
are community-curated GeoJSON.

*Phase A* — `planned-corridors.geojson` with
`voltage_kv: '<img src=x onerror="window.__XSS_TOOLTIP=1">'`, hover the line:

```
tooltip innerHTML:
  <div class="tt-name">SafeName&lt;img src=y onerror="window.__XSS_NAME=1"&gt;</div>
  <div class="tt-metric"><img src="x" onerror="window.__XSS_TOOLTIP=1"> kV · planned</div>

>> voltage_kv injection executed: true
>> name injection executed:      false   ← name is escaped, proving intent
```

*Phase B* — `industrial.geojson` with
`status: 'operational" onmouseover="window.__XSS_ATTR=1'`, click a point, then
hover the pill:

```
<span class="status-pill operational" onmouseover="window.__XSS_ATTR=1">…</span>
>> status attribute injection executed: true
```

Mere hover is enough for the line tooltip — no click required. Because the app
is same-origin with nothing else, impact is limited to defacement, exfiltration
of `localStorage`, and rewriting the source/provenance links a researcher is
being asked to trust — but on any deployment sharing an origin with
authenticated content, it is full account-level XSS.

**Related latent sink (not independently exploitable in Chrome):** `escapeHtml`
escapes metacharacters but does not validate URL schemes, so
`source_url: "javascript:…"` is emitted verbatim into `href`:

```
rendered href: javascript:window.__XSS_HREF=1
>> executed after removing target="_blank": true
```

With the `target="_blank"` the app actually emits, Chromium blocks the
navigation, so we could not execute it as shipped. Reported as hardening, not
as a confirmed exploit: `source_url` should be scheme-checked
(`http`/`https`/`mailto` only) before it reaches an `href`.

---

<a name="f6"></a>
## F6 — Hover-dim is a silent no-op on the industrial and digital layers

**Severity: Medium** (feature does not work; two independent id spaces)

`buildPointLayer()` and `buildDigitalLayer()` create their sources with
`promoteId: "id"` (`app.js:698`, `app.js:737`), so MapLibre keys feature state
by `properties.id` — the string slugs in the data (`"ocp-jorf-lasfar"`).
`loadAllData()` separately stamps a synthetic numeric `f.id = idx*10000 + i`
onto each feature (`app.js:251`), and `setHoverDim()` / `clearHoverDim()`
(`app.js:878-899`) read those numeric ids off `source._data` and pass them to
`setFeatureState()`. The two id spaces never intersect, so no state is ever
applied. `f.id !== keepId` compares a number to a string for the same reason.
`lyr-power-points` is unaffected — it has no `promoteId`.

**Reproduce** — `node audit/f6-hover-dim.js`

```
== POWER (no promoteId) — works ==
hover "Mohammedia Thermal Plant" (id 30)
  id 30 → state {}                    ← hovered, correctly not dimmed
  id 25 → state { dim: true }         ← others dimmed ✓

== INDUSTRIAL (promoteId:"id") — broken ==
hover "SAMIR Refinery (Mohammedia)" (id "samir-mohammedia")
  samir-mohammedia   → state {}
  holcim-bouskoura   → state {}       ← should be { dim: true }
  maghreb-steel-jorf → state {}
  sonasid-jorf       → state {}
  ocp-jorf-lasfar    → state {}
  ocp-khouribga      → state {}
```

The `circle-opacity` `["case",["boolean",["feature-state","dim"],false],0.3,1]`
expressions on `lyr-ind-points`, `lyr-dig-points` and `lyr-dig-cables` are
consequently unreachable. Note it fails *silently* — `setFeatureState` accepts
ids that match nothing without error.

---

<a name="f7"></a>
## F7 — A failed data fetch is rendered as a sourced "0.0 GW"

**Severity: Medium** (API failure handling; a fetch error becomes a false published figure)

`loadAllData()` catches a failed layer fetch, logs to `console.warn`, and
substitutes an empty FeatureCollection (`app.js:254-255`). Nothing propagates to
the UI. `renderKPIs()` then reduces over zero features and renders `0.0 GW`
inside a panel captioned "Snapshot · source: ONEE 2025". The `#noTokenCard`
error surface exists but is only wired to map-engine failures.

**Reproduce** — `node audit/f7-fetch-failure.js` (returns HTTP 503 for
`power-plants.geojson` only; every other request is untouched)

**Expected:** an error or "unavailable" state for the affected figures.

**Actual:**

```
KPI panel:  TRACKED CAPACITY | 0.0 GW | RENEWABLES SHARE* | 0% | DC PIPELINE | 1.5 GW | DC INVESTMENT | $2.2B
#noTokenCard hidden:  true          ← no error surface shown
sidebar:              power-plants=0
snapshot caption:     "source: ONEE 2025"
console (only signal): [MoroccoMap] failed to load power-plants.geojson Error: 503 power-plants.geojson
```

A reader sees "Morocco tracked capacity: 0.0 GW, renewables 0 %, source ONEE
2025" — indistinguishable from a real measurement. Partial outages are the
dangerous case: with only `digital.geojson` failing, "DC pipeline 0.0 GW"
appears beside correct generation figures with no hint of degradation.

---

<a name="f8"></a>
## F8 — 947 HV lines are inert and swallow clicks, leaving a stale popup open

**Severity: Medium** (inconsistent state transition; contradicts the stated provenance guarantee)

`wireLayerInteractions()` (`app.js:830-846`) wires hover/click for
`lyr-grid-*` but not for `lyr-nhv-backbone` / `-regional` / `-distribution`.
Those three layers *are* in `queryableLayers()` (`app.js:389-391`), which the
map-level click handler uses to decide whether to dismiss the popup
(`app.js:218-221`). So a click on a national-HV line matches a queryable layer,
suppresses `closePopup()`, and opens nothing.

**Reproduce** — `node audit/f8-inert-hv-lines.js`

```
click "Mohammedia Thermal Plant"        → popup open: true
hover an "ONEE 225 kV line"             → tooltip display: none   (no tooltip)
                                        → canvas cursor: (default) (no affordance)
click that ONEE 225 kV line             → popup: { open: true, title: "Mohammedia Thermal Plant" }
```

The popup keeps describing a power plant ~700 px away while the user clicks a
transmission line. The click is neither handled nor dismissive — the one input
that should always work (click empty-ish space to dismiss) fails on 92 % of the
map's line features.

**Methodology discrepancy in the same finding.** The methodology modal states:
*"Features include `source`, `source_url`, and `precision` so provenance is
inspectable from the tooltip."* For the 947 `national-hv` features there is no
tooltip at all, and the data carries neither field — its property set is
`coord_confidence` / `coord_method` instead of `precision`, and `source_url` is
absent entirely. The guarantee holds for 77 of 1,024 line features.

---

<a name="f9"></a>
## F9 — Event-listener leak on every theme toggle

**Severity: Low** (unbounded resource growth; duplicated side effects)

The theme handler calls `map.setStyle()` then rebuilds via `buildMapLayers()`
(`app.js:127-132`), which re-runs `wireLayerInteractions()` and the
`map.on("click","lyr-power-clusters")` registration in `buildPowerLayer()`.
No handler is ever removed, so each toggle adds a complete duplicate set.

**Reproduce** — `node audit/f9-listener-leak.js`

```
initial:          click:10  mousemove:9   mouseleave:10  mouseenter:1   (map-level click: 11)
after toggle 1:   click:20  mousemove:18  mouseleave:20  mouseenter:2   (21)
after toggle 2:   click:30  mousemove:27  mouseleave:30  mouseenter:3   (31)
after toggle 3:   click:40  mousemove:36  mouseleave:40  mouseenter:4   (41)
```

Strictly linear, never reclaimed. Each duplicate re-runs `setHoverDim()` (an
O(features) loop) per `mousemove`, and cluster clicks issue N redundant
`getClusterExpansionZoom` + `easeTo` calls. The rebuild itself stays correct
(26 layers after each toggle), so this degrades rather than breaks.

---

<a name="f10"></a>
## F10 — Methodology modal cites a wrong data path and two documents that 404

**Severity: Low** (provenance/documentation integrity)

The modal (`index.html:188,198`) states data lives under
`/docs/data/morocco/` — the actual path is `./data/morocco/` — and links
`../DATA_SOURCES.md` and `../ASSUMPTIONS.md` "for the full write-up". Neither
file exists in the repository; both resolve to 404 from the served root.

```
DATA_SOURCES.md   MISSING      GET /DATA_SOURCES.md  → 404
ASSUMPTIONS.md    MISSING      GET /ASSUMPTIONS.md   → 404
docs/data/morocco/power-plants.geojson  MISSING
```

Two orphaned data files also ship without being referenced by any layer in
`countries.config.js`: `transmission-lines.geojson` (541 features, "World Bank
Group — Morocco Power Sector Masterplan (2018)") and `grid-lines.geojson`
(11 features). `LAYER_KIND` still carries a `"grid-lines"` entry marked
"legacy fallback". For a tool whose stated value is that "every feature carries
a `source` and a source URL", unreferenced data of unclear status in the served
directory is a provenance hazard.

---

## Hypotheses tested and rejected

* **`escapeHtml` bypass via `name` / `source` / `sector`** — all correctly
  escaped; the injected payload in `name` did not execute (F5, Phase A).
* **Feature-id collisions from `idx*10000 + i`** — max index is `national-hv`
  at 40,000–40,946, below the next layer's 50,000 base. No collision.
* **Geographic validity of `national-hv.geojson`** — all 947 lines are inside
  Morocco's bounds, all have ≥ 2 vertices, and `voltage` ↔ `grid_class` is
  consistent for all 947 (60 kV→distribution 411, 150/225 kV→regional 426,
  400 kV→backbone 110). No defect.
* **`addOrReplace("src-oim", …)` before removing its layers** would throw
  "source can't be removed while a layer is using it" on a rebuild, aborting
  `buildMapLayers()` outside the `safe()` wrappers. Not reachable: the theme
  path calls `setStyle()` first (which clears layers) and the country-switch
  path is unreachable while `COUNTRIES_ENABLED` holds only `morocco`. Latent,
  not a defect today.
* **`["coalesce",["to-number",["get","voltage"]],0]` on OpenInfraMap tiles**
  (`app.js:420`) — the comment claims multi-voltage OSM tags such as
  `"400000;225000"` "coerce to 0 and fall into LV", but `to-number` raises on
  an unparseable string and `coalesce` only absorbs `null`. Could not be
  reproduced: `openinframap.org` is unreachable from this environment, so no
  claim is made.
* **Coordinate/hemisphere formatting in `openPointPopup`** — correct for all
  features, including Dakhla at `23.71°N, 15.93°W`.
* **`fmtInvestment` / `fmtCap` rounding** — no unit or precision error found;
  `$2.2B` matches the sum of the four disclosed investments exactly.

## Suggested root-cause fixes

1. **F1** — derive `srcId` and layer ids from `dataLayerId` in
   `buildLineLayer`; make `layersFor()` return per-data-layer ids.
2. **F2/F3/F4** — one shared taxonomy. Normalise `fuel_type` and `status` on
   load, or key the KPI filter, the colour `match`, the halo filter and the CSS
   off a single declared vocabulary. Decide and disclose whether the KPIs are
   operational-only and whether storage counts as generation.
3. **F5** — `escapeHtml(p.voltage_kv)` and `escapeHtml(p.status)`; add a
   `safeUrl()` scheme allowlist for every `href` built from data.
4. **F6** — pick one id space: either drop `promoteId` and keep the synthetic
   numeric ids, or write the synthetic id into `properties.id`.
5. **F7** — track per-layer load failures and render an explicit
   "unavailable" state instead of `0`.
6. **F8** — wire the `lyr-nhv-*` layers into `wireLayerInteractions`, or drop
   them from `queryableLayers()` so clicks still dismiss the popup.
7. **F9** — register delegated handlers once at boot, or track and remove them
   before each rebuild.
