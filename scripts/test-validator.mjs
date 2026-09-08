#!/usr/bin/env node
/* =============================================================
   Mutation tests for validate-integrity.mjs.

   Each case reintroduces a defect that actually shipped, into a
   throwaway copy of the tree, and asserts the matching rule fires.
   This is what stops the validator from being quietly weakened:
   deleting a rule turns its case red.

   Run:  node scripts/test-validator.mjs
   ============================================================= */

import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, unlinkSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Defect → how to reintroduce it → the rule that must catch it.
const CASES = [
  { defect: "#1 byline names one person, links another", rule: "identity-link-mismatch",
    mutate: (d) => sub(d, "index.html", "https://redatahiri.substack.com/?utm_campaign=profile_chips",
                                        "https://paczyzak.substack.com/p/data-centers") },

  { defect: "#2 REPO_URL names a repo that does not exist", rule: "repo-url-mismatch",
    mutate: (d) => sub(d, "app.js", "redatahiri37/morocco-grid", "redatahiri37/morocco-energy-digital-map") },

  { defect: "#3 contact mailto at a reserved domain", rule: "reserved-domain",
    mutate: (d) => sub(d, "index.html", "reda.tahiri1@gmail.com", "reda.tahiri@example.com") },

  { defect: "#4 methodology names a data path that is not there", rule: "claimed-path-missing",
    mutate: (d) => sub(d, "index.html", "<code>./data/morocco/</code>", "<code>/docs/data/morocco/</code>") },

  { defect: "#5 link to a document absent from the repo", rule: "dead-relative-link",
    mutate: (d) => sub(d, "index.html", '<p class="micro">Per-layer sources',
                                        '<p class="micro"><a href="../DATA_SOURCES.md">sources</a> Per-layer sources') },

  { defect: "#7 version strings disagree across files", rule: "version-drift",
    mutate: (d) => sub(d, "index.html", "Morocco Infrastructure Map · v1.6", "Morocco Infrastructure Map · v1.0") },

  { defect: "#8 a rendered layer is never wired for interaction", rule: "layer-not-wired",
    mutate: (d) => sub(d, "app.js", '{ id:"lyr-nhv-backbone",     src:"src-national-hv" },', "") },

  { defect: "#9 line features expose no voltage field the renderer reads", rule: "line-voltage-field",
    mutate: (d) => {
      const p = join(d, "data/morocco/national-hv.geojson");
      const fc = JSON.parse(readFileSync(p, "utf8"));
      for (const f of fc.features) { delete f.properties.voltage; delete f.properties.voltage_kv; }
      writeFileSync(p, JSON.stringify(fc));
    } },

  { defect: "#10 superseded data file left on disk", rule: "orphan-data-file",
    mutate: (d) => writeFileSync(join(d, "data/morocco/grid-lines.geojson"),
      JSON.stringify({ type: "FeatureCollection", features: [] })) },

  { defect: "#6 prose overstates source_url coverage", rule: "source-url-claim",
    mutate: (d) => {
      const p = join(d, "data/morocco/digital.geojson");
      const fc = JSON.parse(readFileSync(p, "utf8"));
      for (const f of fc.features) delete f.properties.source_url;
      writeFileSync(p, JSON.stringify(fc));
    } },

  { defect: "manifest points at a file that is absent", rule: "layer-file-missing",
    mutate: (d) => unlinkSync(join(d, "data/morocco/digital.geojson")) },
];

function sub(dir, file, from, to) {
  const p = join(dir, file);
  const src = readFileSync(p, "utf8");
  if (!src.includes(from)) throw new Error(`fixture drift: ${file} no longer contains ${JSON.stringify(from.slice(0, 60))}`);
  writeFileSync(p, src.replace(from, to));
}

function runValidator(dir) {
  try {
    execFileSync("node", [join(dir, "scripts/validate-integrity.mjs")], { cwd: dir, encoding: "utf8" });
    return { code: 0, out: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

// Baseline: a pristine copy must pass, or every case below is meaningless.
const base = mkdtempSync(join(tmpdir(), "mg-base-"));
cpSync(ROOT, base, { recursive: true, filter: (s) => !s.includes(`${ROOT}/.git/`) });
const baseline = runValidator(base);
rmSync(base, { recursive: true, force: true });

let failed = 0;
console.log("validator mutation tests\n");
if (baseline.code !== 0) {
  console.log("  FAIL  baseline: a clean tree must pass before mutations mean anything");
  console.log(baseline.out.split("\n").map((l) => `        ${l}`).join("\n"));
  process.exit(1);
}
console.log("  ok    baseline clean tree passes\n");

for (const { defect, rule, mutate } of CASES) {
  const dir = mkdtempSync(join(tmpdir(), "mg-mut-"));
  try {
    cpSync(ROOT, dir, { recursive: true, filter: (s) => !s.includes(`${ROOT}/.git/`) });
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git/config"),
      '[remote "origin"]\n\turl = https://github.com/redatahiri37/morocco-grid.git\n');
    mutate(dir);
    const { code, out } = runValidator(dir);
    if (code !== 0 && out.includes(`[${rule}]`)) {
      console.log(`  ok    ${defect}\n          caught by [${rule}]`);
    } else {
      failed++;
      console.log(`  FAIL  ${defect}\n          expected rule [${rule}] to fire; exit=${code}`);
      if (out.trim()) console.log(out.split("\n").map((l) => `          ${l}`).join("\n"));
    }
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${defect}\n          harness error: ${e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n  ${CASES.length - failed}/${CASES.length} defects still caught.`);
process.exit(failed ? 1 : 0);
