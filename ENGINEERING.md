# Engineering practice

This file exists because a batch of defects shipped that were all findable
by machine, and none was found by machine. It records what went wrong, why
it was *possible*, and the check that now makes each recurrence loud.

Run the checks:

```
node scripts/validate-integrity.mjs   # invariants — exits 1 on violation
node scripts/test-validator.mjs       # proves each check still fires
```

Both run on every push and pull request (`.github/workflows/integrity.yml`).

---

## The deeper cause

Eleven defects were found in one review pass. Individually they look
unrelated — a wrong link, an inert map layer, a stale version string. They
are not unrelated. Every invariant in this repository was maintained **by
hand across four files** — `index.html`, `countries.config.js`, `app.js`,
`data/*.geojson` — and **nothing executed to check any of them**. The repo
had no CI at all.

Adding a data layer, for instance, required edits in four places. Three
landing correctly and one being forgotten produced defect #8: 947 rendered
lines that no interaction handler ever touched, for months, silently.

So the fix is not eleven fixes. It is: *make the invariants executable, and
run them.*

---

## Root-cause classes

Every defect gets a class. A new defect that fits none opens a new class.

### C1 — Unverified outbound reference
A URL, mailto, or repo slug written by hand and never checked against
reality. Nothing tied an anchor's **text** to its **href**, so a byline
could name one person and link to another.

| # | Defect | Rule that now catches it |
|---|---|---|
| 1 | Footer byline read "Reda Tahiri", linked to `paczyzak.substack.com` | `identity-link-mismatch` |
| 2 | `REPO_URL` named a repository that does not exist | `repo-url-mismatch` |
| 3 | Contact `mailto:` at `example.com`, a reserved domain | `reserved-domain` |
| 5 | Links to `DATA_SOURCES.md` / `ASSUMPTIONS.md`, neither in the repo | `dead-relative-link` |
| 12 | Basemap served by CARTO, a commercial tile provider, on a map that promises open data | `basemap-not-open` |
| 13 | Map engine loaded from the unpkg CDN; when it failed, a full-screen overlay hid the map | `engine-cdn` |

`identity-link-mismatch` is the interesting one: it holds a map of identity →
legitimate domains, so naming a person in link text while pointing elsewhere
is a build failure. Crediting someone else stays correct — the rule checks
that text and href agree, not that every link is ours.

### C2 — Prose asserting facts that nothing verifies
The UI makes checkable claims — a path, a coverage guarantee, a version —
and drift is invisible because no test reads both the claim and the data.

| # | Defect | Rule |
|---|---|---|
| 4 | Methodology named `/docs/data/morocco/`; actual path `./data/morocco/` | `claimed-path-missing` |
| 6 | "Every feature carries a source URL" — 989 of 1023 did not | `source-url-claim` |
| 7 | UI said v1.0 across a v1.6 build | `version-drift` |

`source-url-claim` parses the sentence in `index.html` and compares it to
actual per-feature coverage. Changing the data without changing the
sentence fails, and so does the reverse.

### C3 — Registered in one place, consumed in several
A layer must be declared in the manifest, given a kind, built, *and* wired
for interaction. Nothing enforced the set.

| # | Defect | Rule |
|---|---|---|
| 8 | `lyr-nhv-*` never added to `wireLayerInteractions()`; 947 lines inert | `layer-not-wired` |
| 9 | Renderers read `voltage_kv`; `national-hv` stores `voltage` as a string | `line-voltage-field` |

Defect #9 is a schema-contract failure: a new file used a different field
name for the same concept, and the shared renderer printed `undefined kV`.
The rule requires every line feature to expose a field the renderer reads.

### C4 — Superseded artifact left on disk
Files stop being referenced and nothing notices.

| # | Defect | Rule |
|---|---|---|
| 10 | `grid-lines.geojson` unreferenced; fully absorbed by two other layers | `orphan-data-file` |
| 11 | `transmission-lines.geojson` unreferenced — but *not* a duplicate | `orphan-data-file` + `RETAINED` |
| 14 | Mapbox-era token overlay (`#noTokenCard`, token-input CSS) survived the MapLibre migration | `token-ui-remnant` |

The distinction matters and is why deletion is not the automatic remedy.
`grid-lines` was genuinely superseded — its 8 planned features are in
`planned-corridors.geojson`, its 3 operational in `interconnectors.geojson`
— so it was removed. `transmission-lines` looked superseded but is an
independent World Bank Masterplan 2018 dataset; `national-hv` is
ONEE/OSM-derived. Copying source URLs across would have **invented
provenance**. It is retained with a written reason instead.

---

## The standing agenda item

The point of the register below is that deliberate exceptions decay into
permanent ones when nobody re-reads them. So the meeting input is generated,
not remembered.

`validate-integrity.mjs` prints a `note` line for every deliberate exception
— retained files, documented data gaps. **Those notes are the agenda.**
Paste the output; it is current by construction.

Each meeting, for each note:

1. **Is the reason still true?** `transmission-lines.geojson` is retained
   pending a decision on wiring it as its own layer. A pending decision that
   is still pending three meetings later is not pending, it is declined —
   say so and delete, or schedule it.
2. **Has the gap moved?** `power-plants.geojson` has 0/42 per-feature source
   URLs because its 42 features cite twelve different sources. Track the
   number. If it has not moved in a quarter, either fund the curation or
   stop advertising it as a gap and call it the design.
3. **Any new defect since last time?** Classify it C1–C4, or open a class.

And the rule that keeps this from rotting:

> **A defect is not closed until a check exists that would have caught it.**

A fix without a check is a fix that ships again. When a defect resists
automation, say so explicitly and record why — an unautomatable defect is a
design smell worth its own agenda slot.

### Adding a check

1. Add the rule to `validate-integrity.mjs`, tagged with its class.
2. Add a case to `scripts/test-validator.mjs` that reintroduces the defect
   and asserts the rule fires.
3. Confirm the case fails when the rule is removed. A check with no
   mutation test is not yet a check.

---

## Current exceptions

| Item | Status | Why |
|---|---|---|
| `transmission-lines.geojson` | Retained, unreferenced | Independent WBG 2018 HV dataset (541 features, full source URLs). Not a duplicate of `national-hv`. Pending a decision on surfacing it as its own layer. |
| `power-plants.geojson` source URLs | 0/42, documented | Its features cite twelve distinct sources; no single URL is honest. Needs per-feature curation — a data task, not a code one. |
| `national-hv` precision field | Uses `coord_method` / `coord_confidence` | Different provenance model from `precision`; documented in Methodology rather than coerced into a shape that would misdescribe it. |

---

## Defects 12–14: the token overlay

Reported as "the API token not found layer". The chain:

1. The map was built on Mapbox, which needs an access token. A full-screen
   card (`#noTokenCard`) handled the missing-token case.
2. The v1.1 migration to MapLibre removed the need for a token but kept the
   card, reworded as "Map engine unavailable". The id, class names and
   token-input CSS stayed — a C4 artifact that outlived its reason.
3. MapLibre itself loaded from unpkg. Any CDN failure left `maplibregl`
   undefined, and the leftover card covered the whole map. A third-party
   dependency could take down the page's main feature, and the fallback for
   it was a relic.
4. Separately, the basemap came from CARTO: free to use, but a commercial
   provider, on a map whose whole positioning is open and inspectable data.

Fix: MapLibre GL JS 4.7.1 (BSD-3-Clause) is vendored under
`vendor/maplibre-gl/`, so the engine ships with the page and cannot fail
independently of it. With no independent failure mode left, the overlay
has no job, and is deleted along with its CSS. The basemap is
OpenStreetMap's own tiles, rendered inverted and desaturated for dark mode.

The three rules above were verified against `main` at `4e05a96`, before the
fix: 8 violations there, 0 after.

Remaining open external dependency, for the agenda: label glyphs come from
`demotiles.maplibre.org`, MapLibre's demo font server. It is open source but
not intended for production traffic. Vendoring the two font stacks the map
uses would close it.
