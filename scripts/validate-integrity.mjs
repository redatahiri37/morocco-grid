#!/usr/bin/env node
/* =============================================================
   Repository integrity checks.

   Every rule here exists because a real defect shipped. Each is
   tagged with its root-cause class (see ENGINEERING.md):

     C1  unverified outbound reference
     C2  prose asserting facts about data that nothing verifies
     C3  layer registered in one place, consumed in several
     C4  superseded artifact left on disk

   Run:  node scripts/validate-integrity.mjs
   Exit: 0 clean, 1 on any violation.
   No dependencies — this must stay runnable on a bare checkout.
   ============================================================= */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const R = (p) => join(ROOT, p);
const read = (p) => readFileSync(R(p), "utf8");

const violations = [];
const notes = [];
const fail = (cls, rule, msg) => violations.push({ cls, rule, msg });
const note = (msg) => notes.push(msg);

/* ── Load the layer manifest without a browser ───────────────── */
function loadCountries() {
  const src = read("countries.config.js");
  const window = {};
  new Function("window", src)(window);
  return { countries: window.COUNTRIES || {}, enabled: window.COUNTRIES_ENABLED || [] };
}
const { countries, enabled } = loadCountries();
const html = read("index.html");
const appjs = read("app.js");

/* =============================================================
   C1 — outbound references must resolve and must agree with the
   text that introduces them.
   ============================================================= */

// Identity → the domains that legitimately represent that identity.
// Defect #1: the footer byline read "Reda Tahiri" but pointed at
// Pawel Czyzak's Substack. Anchor text and href must name the same party.
const IDENTITY_DOMAINS = {
  "Reda Tahiri":  ["redatahiri.substack.com", "github.com/redatahiri37"],
  "Pawel Czyzak": ["paczyzak.substack.com"],
};

// Domains reserved by RFC 2606 / RFC 6761 — never valid in shipped output.
const RESERVED_DOMAINS = ["example.com", "example.org", "example.net", "localhost", "test.invalid"];

const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  .map(([, href, inner]) => ({ href, text: inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() }));

for (const { href, text } of anchors) {
  for (const [identity, domains] of Object.entries(IDENTITY_DOMAINS)) {
    if (!text.includes(identity)) continue;
    if (!domains.some((d) => href.includes(d))) {
      fail("C1", "identity-link-mismatch",
        `anchor text names "${identity}" but href is ${href} (expected one of: ${domains.join(", ")})`);
    }
  }
}

for (const file of ["index.html", "app.js"]) {
  const src = read(file);
  for (const d of RESERVED_DOMAINS) {
    if (src.includes(d)) fail("C1", "reserved-domain", `${file} ships reserved domain "${d}"`);
  }
}

// Relative links must resolve on disk. Defect #5: dead DATA_SOURCES.md.
for (const { href } of anchors) {
  if (/^(https?:|mailto:|#|data:)/i.test(href)) continue;
  const target = href.replace(/[?#].*$/, "");
  if (!existsSync(resolve(ROOT, target)) && !existsSync(resolve(ROOT, "..", target))) {
    fail("C1", "dead-relative-link", `index.html links "${href}" which does not exist`);
  }
}

// Defect #2: REPO_URL named a repository that does not exist. Pin it to
// this checkout's own origin so it cannot drift from reality.
// Shape alone is not enough: the shipped value was a well-formed GitHub URL
// for a repository that did not exist. Pin it to this checkout's own origin,
// which is ground truth and needs no network.
const repoUrl = (appjs.match(/const\s+REPO_URL\s*=\s*["']([^"']+)["']/) || [])[1];
if (!repoUrl) {
  fail("C1", "repo-url-missing", "app.js no longer defines REPO_URL");
} else if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repoUrl)) {
  fail("C1", "repo-url-shape", `REPO_URL is not a plain github repo URL: ${repoUrl}`);
} else {
  const origin = originSlug();
  if (origin && !repoUrl.endsWith(`/${origin}`)) {
    fail("C1", "repo-url-mismatch",
      `REPO_URL points at "${repoUrl}" but this checkout's origin is "${origin}"`);
  }
}

/** owner/repo of the git origin remote, or null if undeterminable. */
function originSlug() {
  for (const p of [".git/config", ".git"]) {
    try {
      const cfg = existsSync(R(".git/config"))
        ? read(".git/config")
        : readFileSync(join(read(".git").trim().replace(/^gitdir:\s*/, ""), "config"), "utf8");
      const m = cfg.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/s);
      if (!m) return null;
      const slug = m[1].match(/([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
      return slug ? slug[1] : null;
    } catch { /* fall through */ }
  }
  return null;
}

/* =============================================================
   C2 — a claim the UI makes about data must be true of the data.
   ============================================================= */

// Defect #7: UI said v1.0 while the build was v1.6.
const versions = new Set();
for (const [file, re] of [
  ["index.html", /Morocco Infrastructure Map · (v\d+\.\d+)/],
  ["index.html", /(v\d+\.\d+) of a platform scaling/],
  ["index.html", /Known data gaps \((v\d+\.\d+)\)/],
  ["style.css",  /Morocco Infrastructure Map (v\d+\.\d+)/],
]) {
  const m = read(file).match(re);
  if (m) versions.add(m[1]);
}
if (versions.size > 1) {
  fail("C2", "version-drift", `conflicting version strings across files: ${[...versions].join(", ")}`);
}

// Defect #4: methodology named a data path that does not exist.
for (const m of html.matchAll(/<code>(\.?\/[\w./-]*data\/[\w./-]*)<\/code>/g)) {
  const claimed = m[1].replace(/^\//, "./");
  if (!existsSync(resolve(ROOT, claimed))) {
    fail("C2", "claimed-path-missing", `index.html claims data lives at "${m[1]}", which does not exist`);
  }
}

/* =============================================================
   C3 / C4 — layer manifest, wiring, schema and orphan checks.
   ============================================================= */

// Files intentionally kept on disk while unreferenced. Anything here is a
// tracked decision, not an oversight — it must carry a reason.
const RETAINED = {
  "data/morocco/transmission-lines.geojson":
    "World Bank Masterplan 2018 HV set (541 features, full source URLs). Independent of " +
    "national-hv.geojson, which is ONEE/OSM-derived — not a superseded duplicate. " +
    "Pending a decision on wiring it up as its own layer.",
};

for (const [key, country] of Object.entries(countries)) {
  const dir = country.dataPath?.replace(/^\.\//, "").replace(/\/$/, "");
  if (!dir || !existsSync(R(dir))) {
    if (!country.placeholder) fail("C3", "datapath-missing", `country "${key}" dataPath "${country.dataPath}" does not exist`);
    continue;
  }

  const onDisk = readdirSync(R(dir)).filter((f) => f.endsWith(".geojson"));
  const referenced = new Set(country.layers.map((l) => l.file).filter(Boolean));
  referenced.add("boundary.geojson"); // loaded directly by app.js, not via the manifest

  // C3: manifest points at a file that is not there.
  for (const f of referenced) {
    if (!onDisk.includes(f)) fail("C3", "layer-file-missing", `${key}: manifest references ${dir}/${f}, absent on disk`);
  }

  // C4: file on disk that nothing loads.
  for (const f of onDisk) {
    const rel = `${dir}/${f}`;
    if (referenced.has(f)) continue;
    if (RETAINED[rel]) { note(`retained unreferenced: ${rel} — ${RETAINED[rel]}`); continue; }
    fail("C4", "orphan-data-file", `${rel} is on disk but referenced by neither the manifest nor app.js`);
  }

  // C3: every manifest layer must have a kind, and every renderable layer
  // must be wired for hover/click. Defect #8: national-hv rendered 947
  // lines that no interaction handler ever touched.
  const kindBlock = (appjs.match(/const LAYER_KIND\s*=\s*\{([\s\S]*?)\};/) || [])[1] || "";
  const kinds = Object.fromEntries(
    [...kindBlock.matchAll(/"([\w-]+)"\s*:\s*"([\w-]+)"/g)].map(([, k, v]) => [k, v]));

  const wiredBlock = appjs.match(/function wireLayerInteractions\(\)\{([\s\S]*?)\n  \}/);
  const wired = wiredBlock ? wiredBlock[1] : "";

  // A layer kind → the map-layer id prefix its features render under.
  const KIND_LAYER_IDS = {
    "power":         ["lyr-power-points"],
    "industrial":    ["lyr-ind-points"],
    "digital":       ["lyr-dig-points", "lyr-dig-cables"],
    "grid":          ["lyr-grid-hv"],
    "national-grid": ["lyr-nhv-backbone", "lyr-nhv-regional", "lyr-nhv-distribution"],
    "oim":           [], // third-party vector tiles, not our features
  };

  for (const layer of country.layers) {
    const kind = kinds[layer.id];
    if (!kind) { fail("C3", "layer-kind-missing", `${key}: layer "${layer.id}" has no LAYER_KIND entry`); continue; }
    for (const mapId of KIND_LAYER_IDS[kind] ?? []) {
      if (!wired.includes(`"${mapId}"`)) {
        fail("C3", "layer-not-wired",
          `${key}: layer "${layer.id}" (kind ${kind}) renders as "${mapId}" but that id is absent from wireLayerInteractions()`);
      }
    }
    if (!layer.sourceUrl || !/^https?:\/\//.test(layer.sourceUrl)) {
      fail("C1", "layer-source-url", `${key}: layer "${layer.id}" has no usable sourceUrl`);
    }
  }

  // C3: schema contract. Defect #9 — national-hv stored voltage as a string
  // while every other line layer used numeric voltage_kv, so the shared
  // renderer printed "undefined kV".
  for (const layer of country.layers) {
    if (!layer.file) continue;
    // A missing file is already reported above as layer-file-missing; skip it
    // here rather than dying, so one fault does not mask every later check.
    if (!existsSync(R(`${dir}/${layer.file}`))) continue;
    const fc = JSON.parse(read(`${dir}/${layer.file}`));
    const feats = fc.features || [];
    if (!feats.length) { fail("C3", "empty-layer", `${dir}/${layer.file} has no features`); continue; }

    const missingSource = feats.filter((f) => !f.properties?.source).length;
    if (missingSource) fail("C2", "feature-source-missing", `${layer.file}: ${missingSource}/${feats.length} features lack "source"`);

    const isLine = feats[0].geometry?.type?.includes("LineString");
    if (isLine) {
      const noVoltage = feats.filter((f) => {
        const p = f.properties || {};
        return (p.voltage_kv === undefined || p.voltage_kv === "") && !p.voltage;
      }).length;
      if (noVoltage) {
        fail("C3", "line-voltage-field",
          `${layer.file}: ${noVoltage}/${feats.length} line features expose neither voltage_kv nor voltage`);
      }
    }
  }
}

/* =============================================================
   C2 — the source_url coverage the UI advertises must be real.
   ============================================================= */
{
  const dir = "data/morocco";
  const manifest = countries.morocco.layers.filter((l) => l.file && existsSync(R(`${dir}/${l.file}`)));
  const gaps = [];
  for (const l of manifest) {
    const feats = JSON.parse(read(`${dir}/${l.file}`)).features || [];
    const withUrl = feats.filter((f) => f.properties?.source_url).length;
    if (withUrl !== feats.length) gaps.push({ file: l.file, withUrl, total: feats.length });
  }
  // index.html states exactly one layer is exempt (power generation). If that
  // stops being true in either direction, the prose is now lying.
  const claimsSingleException = /every layer but one also carries a per-feature source/i.test(html);
  if (claimsSingleException && gaps.length !== 1) {
    fail("C2", "source-url-claim",
      `index.html claims exactly one layer lacks per-feature source_url, but ${gaps.length} do: ` +
      gaps.map((g) => `${g.file} (${g.withUrl}/${g.total})`).join(", "));
  }
  if (gaps.length === 1) note(`documented source_url gap: ${gaps[0].file} (${gaps[0].withUrl}/${gaps[0].total})`);
}

/* ── Report ──────────────────────────────────────────────────── */
const byClass = {};
for (const v of violations) (byClass[v.cls] ??= []).push(v);

console.log("repository integrity\n");
for (const n of notes) console.log(`  note  ${n}`);
if (notes.length) console.log("");

if (!violations.length) {
  console.log(`  PASS  ${enabled.length} country manifest(s), all invariants hold`);
  process.exit(0);
}
for (const cls of Object.keys(byClass).sort()) {
  console.log(`  ${cls}`);
  for (const v of byClass[cls]) console.log(`    FAIL  [${v.rule}] ${v.msg}`);
}
console.log(`\n  ${violations.length} violation(s). See ENGINEERING.md for the root-cause class definitions.`);
process.exit(1);
