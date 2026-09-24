#!/usr/bin/env node
/* =============================================================
   Runtime checks in a real browser.

   validate-integrity.mjs reads source text; some defects only exist
   once the page runs. Both of these shipped and passed every static
   check:

     - two line layers wrote to one map source, so the second build
       replaced the first's data and three interconnectors never
       reached the map; toggling either layer hid both
     - interaction handlers were re-registered on every rebuild, so
       after N theme toggles one click opened the popup N+1 times
     - clicking a power-plant cluster did nothing: MapLibre 4 made
       getClusterExpansionZoom promise-based, and the callback passed
       to it was silently ignored

   Run:  node scripts/test-render.mjs
   Needs: playwright (CI installs it; locally set CHROMIUM_PATH if
   the bundled browser is not installed).
   ============================================================= */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".geojson": "application/geo+json",
  ".png": "image/png", ".svg": "image/svg+xml",
};

// Serve the checkout itself — no external server needed.
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(ROOT, path === "/" ? "index.html" : path);
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" })
     .end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// Every feature the manifest promises, as a multiset of names.
const win = {};
new Function("window", readFileSync(join(ROOT, "countries.config.js"), "utf8"))(win);
const country = win.COUNTRIES[(win.COUNTRIES_ENABLED || ["morocco"])[0]];
const dataDir = join(ROOT, country.dataPath);
const files = [...country.layers.filter((l) => l.file).map((l) => l.file), "boundary.geojson"];
const expected = new Map();
for (const f of files) {
  for (const feat of JSON.parse(readFileSync(join(dataDir, f), "utf8")).features) {
    const k = feat.properties?.name ?? "(unnamed)";
    expected.set(k, (expected.get(k) || 0) + 1);
  }
}

const failures = [];
const check = (ok, msg, detail) => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${msg}`);
  if (!ok) { failures.push(msg); if (detail) console.log(`          ${detail}`); }
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && /\[MoroccoMap\]/.test(m.text())) pageErrors.push(m.text());
});

// Capture the map instance from outside the app's closure.
await page.addInitScript(() => {
  let real;
  Object.defineProperty(window, "maplibregl", {
    configurable: true,
    get() { return real; },
    set(v) {
      const M = v.Map;
      v.Map = class extends M { constructor(o) { super(o); window.__map = this; } };
      real = v;
    },
  });
});

const sourceNames = () => page.evaluate(() => {
  const counts = {};
  for (const s of Object.values(window.__map.getStyle().sources)) {
    if (s.type !== "geojson") continue;
    for (const f of s.data.features || []) {
      const k = f.properties?.name ?? "(unnamed)";
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  return counts;
});

const waitForData = () => page.waitForFunction((n) => {
  const m = window.__map;
  if (!m || !m.getStyle()) return false;
  const geo = Object.values(m.getStyle().sources).filter((s) => s.type === "geojson");
  return geo.reduce((a, s) => a + (s.data.features || []).length, 0) >= n;
}, [...expected.values()].reduce((a, b) => a + b, 0) - 50, { timeout: 30000 }).catch(() => {});

function compareData(label, got) {
  const missing = [], extra = [];
  for (const [k, n] of expected) if ((got[k] || 0) < n) missing.push(`${k} (${got[k] || 0}/${n})`);
  for (const [k, n] of Object.entries(got)) if (n > (expected.get(k) || 0)) extra.push(`${k} (+${n - (expected.get(k) || 0)})`);
  check(!missing.length && !extra.length,
    `${label}: every manifest feature reaches the map exactly once`,
    [missing.length && `missing: ${missing.slice(0, 5).join("; ")}`, extra.length && `extra: ${extra.slice(0, 5).join("; ")}`]
      .filter(Boolean).join(" | "));
}

const clickHandlers = () => page.evaluate(() => (window.__map._delegatedListeners?.click || []).length);

try {
  console.log("render tests\n");
  await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
  await waitForData();
  await page.waitForTimeout(1500);

  check(await page.evaluate(() => !!window.__map), "map engine initialises (vendored, no CDN)");
  check(await page.evaluate(() => !document.querySelector("#noTokenCard, .no-token")), "no token / engine-error overlay in the page");
  compareData("initial load", await sourceNames());

  // Each layer toggle must hide exactly its own map layers and no other's.
  const rows = await page.$$eval("#layerList .layer-row", (els) => els.map((e) => e.dataset.layer));
  const owned = {};
  for (const id of rows) {
    owned[id] = await page.evaluate((id) => {
      const m = window.__map;
      const vis = () => Object.fromEntries(m.getStyle().layers.map((l) => [l.id, m.getLayoutProperty(l.id, "visibility") || "visible"]));
      const before = vis();
      document.querySelector(`#layerList .layer-row[data-layer="${id}"] input`).click();
      const after = vis();
      document.querySelector(`#layerList .layer-row[data-layer="${id}"] input`).click();
      return Object.keys(after).filter((k) => after[k] !== before[k]);
    }, id);
  }
  for (const id of rows) check(owned[id].length > 0, `toggling "${id}" changes its own map layers`);
  const clashes = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const shared = owned[rows[i]].filter((x) => owned[rows[j]].includes(x));
    if (shared.length) clashes.push(`"${rows[i]}" and "${rows[j]}" both control ${shared.join(", ")}`);
  }
  check(!clashes.length, "no two layer toggles control the same map layer", clashes.join(" | "));

  // Clicking a power-plant cluster must zoom in. MapLibre 4 made
  // getClusterExpansionZoom promise-based and the old callback was ignored.
  await page.waitForTimeout(1500); // let the toggle checks' last frame render
  const cluster = await page.evaluate(() => {
    const m = window.__map;
    const f = m.queryRenderedFeatures({ layers: ["lyr-power-clusters"] })[0];
    if (!f) return null;
    const pt = m.project(f.geometry.coordinates);
    const box = m.getCanvas().getBoundingClientRect();
    return { x: box.left + pt.x, y: box.top + pt.y, zoom: m.getZoom() };
  });
  if (!cluster) {
    check(false, "a power-plant cluster is rendered at the initial view", "no lyr-power-clusters features rendered");
  } else {
    await page.mouse.click(cluster.x, cluster.y);
    await page.waitForTimeout(1500);
    const zoomAfter = await page.evaluate(() => window.__map.getZoom());
    check(zoomAfter > cluster.zoom + 0.5, "clicking a power-plant cluster zooms in",
      `zoom ${cluster.zoom.toFixed(2)} -> ${zoomAfter.toFixed(2)}`);
    await page.evaluate((z) => window.__map.jumpTo({ zoom: z }), cluster.zoom);
  }

  // Rebuilds (theme toggle) must not stack interaction handlers or lose data.
  const handlersBefore = await clickHandlers();
  for (let i = 0; i < 2; i++) {
    await page.click("#themeToggle");
    await page.waitForTimeout(2500);
  }
  const handlersAfter = await clickHandlers();
  check(handlersBefore > 0 && handlersAfter === handlersBefore,
    "theme toggles do not stack interaction handlers",
    `click handlers: ${handlersBefore} after load, ${handlersAfter} after two toggles`);
  compareData("after two theme toggles", await sourceNames());

  check(!pageErrors.length, "no page errors or failed layer builds", pageErrors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n  ${failures.length ? `${failures.length} failure(s)` : "all render checks pass"}`);
process.exit(failures.length ? 1 : 0);
