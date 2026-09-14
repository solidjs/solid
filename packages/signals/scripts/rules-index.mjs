// Generates docs/RULES-INDEX.md — one row per rule ID across every vocabulary
// the code and tests cite — and resolves every citation in src/ and tests/.
//
//   node scripts/rules-index.mjs            # write docs/RULES-INDEX.md
//   node scripts/rules-index.mjs --check    # exit 1 if a src/ citation does not resolve
//
// Vocabularies (IDs are NEVER renumbered; this file only indexes them):
//   A<n>      SPEC-ASYNC-SEMANTICS.md Tier-A propositions (table rows)
//   B<n>/C<n> SPEC tier B/C entries
//   V<n>      SPEC "Known violations" (fixed)
//   INV-<n>   INTERNALS-ASYNC-STATE.md §5 invariants
//   RUL-<n>   INTERNALS-STORE-STATE.md §8b rulings (+ rules-mining/FINDINGS.md)
//   <NS>-R<n> rules-mining/*.md mined rules. Each file numbers from R1, so an
//             R-id is only meaningful WITH its namespace: CS core-store,
//             OL optimistic-lanes, OS optimistic-store, PJ projections,
//             RS reconcile-snapshot. Source comments qualify with the words
//             "core", "opt", "proj", "snap"; a bare R<n> in a module comment
//             refers to that module's file (store/target → CS, reconcile → RS,
//             projection → PJ, optimistic → OS, core/* → OL).
//   §<n>      INTERNALS-STORE-STATE.md numbered sections, and NODE-SHAPE.md's
//             recovered stage-3 sections (§11b, §12–§12e).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");
const read = p => fs.readFileSync(p, "utf8");
const rel = p => path.relative(ROOT, p);
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|md)$/.test(e.name)) out.push(p);
  }
  return out;
};

// ── definitions ────────────────────────────────────────────────────────────
const rules = new Map(); // key -> { key, id, vocab, ns, def, status, text }
function status(text) {
  const head = text.slice(0, 160);
  if (/SUPERSEDED/.test(text)) return "superseded";
  if (/RETIRED/.test(head)) return "retired";
  if (/RULED OUT/.test(head)) return "ruled out";
  if (/— FIXED|FIXED\.\*\*/.test(head)) return "fixed";
  if (/RESOLVED/.test(head)) return "resolved";
  if (/CLOSED by/.test(head)) return "closed";
  if (
    /re-ruled|Amended|amended|refined by re-rule|Re-scoped|Phrasing updated|was [BC]\d/i.test(head)
  )
    return "amended";
  if (/RULED|ruled 20/.test(head)) return "ruled";
  return "live";
}
function add(key, id, vocab, ns, file, line, text) {
  if (rules.has(key)) return;
  rules.set(key, {
    key,
    id,
    vocab,
    ns,
    def: `${rel(file)}:${line}`,
    status: status(text),
    text: text.replace(/\s+/g, " ").trim()
  });
}
function scan(file, re, mk) {
  if (!fs.existsSync(file)) return;
  read(file)
    .split("\n")
    .forEach((l, i) => {
      const m = re.exec(l);
      if (m) mk(m, i + 1, l);
    });
}
const SPEC = path.join(DOCS, "SPEC-ASYNC-SEMANTICS.md");
scan(SPEC, /^\| (A\d{1,2}) +\|(.*)$/, (m, n) => add(m[1], m[1], "A", "", SPEC, n, m[2]));
scan(SPEC, /^- \*\*(V\d)\b(.*)$/, (m, n, l) => add(m[1], m[1], "V", "", SPEC, n, l));
// Tier B/C ids promoted into A-rules ("(was B1)") keep resolving to the row they became.
scan(SPEC, /^\| (A\d{1,2}) +\|.*\(was ([BC]\d)\b/, (m, n) =>
  add(m[2], m[2], m[2][0], "", SPEC, n, `PROMOTED → ${m[1]} (${m[1]}'s row carries the ruling).`)
);
scan(SPEC, /^- \[[ x]\] \*\*([BC]\d)\b(.*)$/, (m, n, l) =>
  add(m[1], m[1], m[1][0], "", SPEC, n, l)
);
const IAS = path.join(DOCS, "INTERNALS-ASYNC-STATE.md");
scan(IAS, /^- \*\*(INV-\d+)\b(.*)$/, (m, n, l) => add(m[1], m[1], "INV", "", IAS, n, l));
const ISS = path.join(DOCS, "INTERNALS-STORE-STATE.md");
for (const f of [ISS, path.join(DOCS, "rules-mining/FINDINGS.md")])
  scan(f, /^- \*\*(RUL-\d+)\b(.*)$/, (m, n, l) => add(m[1], m[1], "RUL", "", f, n, l));
scan(ISS, /^## (\d+[a-z]?)\. (.*)$/, (m, n) => add("§" + m[1], "§" + m[1], "§", "", ISS, n, m[2]));
scan(ISS, /^Corollary (R\d+[a-z])\b(.*)$/, (m, n, l) =>
  add("CS-" + m[1], m[1], "R", "CS", ISS, n, l)
);
const NS = {
  "core-store": "CS",
  "optimistic-lanes": "OL",
  "optimistic-store": "OS",
  projections: "PJ",
  "reconcile-snapshot": "RS"
};
for (const [file, ns] of Object.entries(NS)) {
  const f = path.join(DOCS, "rules-mining", file + ".md");
  scan(f, /^\*\*(R\d{1,2}[a-z]?)[.\s*—-]+(.*)$/, (m, n) =>
    add(ns + "-" + m[1], m[1], "R", ns, f, n, m[2])
  );
}
const SHAPE = path.join(DOCS, "NODE-SHAPE.md");
scan(SHAPE, /^#{2,3} §?(\d+[a-z]?)\. (.*)$/, (m, n) =>
  add("§" + m[1], "§" + m[1], "§", "", SHAPE, n, m[2])
);

// ── citations ──────────────────────────────────────────────────────────────
const MODULE_NS = [
  [/store\/next\/reconcile\.ts$/, "RS"],
  [/store\/next\/projection\.ts$/, "PJ"],
  [/store\/next\/optimistic\.ts$/, "OS"],
  [/store\/next\/(store|target)\.ts$/, "CS"],
  [/store\//, "CS"],
  [/core\//, "OL"]
];
const QUAL = { core: "CS", opt: "OS", proj: "PJ", snap: "RS", lanes: "OL", lane: "OL" };
function nsFor(file, qualifier) {
  if (qualifier && QUAL[qualifier]) return QUAL[qualifier];
  for (const [re, ns] of MODULE_NS) if (re.test(file)) return ns;
  return "CS";
}
const CITE =
  /\b(A\d{1,2}|V[1-5]|INV-\d+|RUL-\d+|[BC]\d)\b(?![.\d])|(?:\b(core|opt|proj|snap|lanes?)\s+)?\bR(\d{1,2}[a-z]?)\b|(§\d+[a-z]?)/g;
function citationsIn(file) {
  const out = [];
  const c = read(file);
  for (const m of c.matchAll(CITE)) {
    if (m[1]) out.push(m[1]);
    else if (m[3]) {
      const ns = nsFor(file, m[2]);
      // A bare R<n> the citing module's own file does not define is a
      // core-store rule (the base vocabulary every store module builds on).
      out.push(rules.has(ns + "-R" + m[3]) || m[2] ? ns + "-R" + m[3] : "CS-R" + m[3]);
    } else if (m[4]) out.push(m[4]);
  }
  return out;
}
const srcFiles = walk(path.join(ROOT, "src")).filter(f => /\.tsx?$/.test(f));
const testFiles = walk(path.join(ROOT, "tests")).filter(f => /\.tsx?$/.test(f));
const cited = { src: new Map(), tests: new Map() };
for (const [kind, files] of [
  ["src", srcFiles],
  ["tests", testFiles]
])
  for (const f of files)
    for (const id of citationsIn(f)) {
      const m = cited[kind].get(id) ?? new Map();
      m.set(rel(f), (m.get(rel(f)) ?? 0) + 1);
      cited[kind].set(id, m);
    }
const fmtCites = m => (m ? [...m].map(([f, n]) => `${path.basename(f)}×${n}`).join(" ") : "—");
const unresolved = kind => [...cited[kind].keys()].filter(id => !rules.has(id)).sort();

// ── output ─────────────────────────────────────────────────────────────────
if (process.argv.includes("--check")) {
  const bad = unresolved("src");
  if (bad.length) {
    console.error("rules-index: citations in src/ that resolve to no definition:", bad.join(" "));
    process.exit(1);
  }
  console.log("rules-index: every src/ citation resolves (" + cited.src.size + " ids)");
  process.exit(0);
}
const order = { A: 0, V: 1, B: 2, C: 3, INV: 4, RUL: 5, R: 6, "§": 7 };
const rows = [...rules.values()].sort(
  (a, b) =>
    order[a.vocab] - order[b.vocab] ||
    (a.ns || "").localeCompare(b.ns || "") ||
    parseInt(a.id.replace(/\D/g, "")) - parseInt(b.id.replace(/\D/g, "")) ||
    a.id.localeCompare(b.id)
);
const esc = s => s.replace(/\|/g, "\\|");
const L = [];
L.push("# Rules Index — every rule ID the code and tests cite, and where it lives", "");
L.push(
  "**Generated by `scripts/rules-index.mjs`; do not edit by hand.** Regenerate with `node scripts/rules-index.mjs`; `--check` fails when a `src/` citation resolves to nothing (run in `pnpm test` via `tests/rules-index.test.ts`).",
  ""
);
L.push(
  "IDs are never renumbered or deleted — source comments cite them. A superseded, retired or fixed rule keeps its row with its status; the statement column shows how it reads at its definition (first ~200 chars).",
  ""
);
L.push(
  "## Vocabularies",
  "",
  "| prefix | defined in | meaning |",
  "|---|---|---|",
  "| `A<n>` | `SPEC-ASYNC-SEMANTICS.md` Tier A | ruled, test-pinned propositions about isPending / latest / transitions / optimistic lanes |",
  "| `B<n>` `C<n>` | `SPEC-ASYNC-SEMANTICS.md` Tier B/C | inferred / open items, all since ruled, closed or promoted into an A-rule (`(was B1)` — the alias row points at it) |",
  "| `V<n>` | `SPEC-ASYNC-SEMANTICS.md` Known violations | violations of A-rules found and fixed by the #2838 redesign; pinned in `spec-async-semantics.test.ts` |",
  "| `INV-<n>` | `INTERNALS-ASYNC-STATE.md` §5 | `__TEST__` invariants (asserted in `invariants.ts`) |",
  "| `RUL-<n>` | `INTERNALS-STORE-STATE.md` §8b, `rules-mining/FINDINGS.md` | store rulings mined from the suites (2026-08-16) |",
  "| `<NS>-R<n>` | `rules-mining/<file>.md` | mined behavioral rules. **Each file numbers from R1**, so an R-id is only meaningful with its namespace: `CS` core-store · `OL` optimistic-lanes · `OS` optimistic-store · `PJ` projections · `RS` reconcile-snapshot. Comments qualify with `core`/`opt`/`proj`/`snap`; a bare `R<n>` refers to the citing module's own file. |",
  "| `§<n>` | `INTERNALS-STORE-STATE.md` sections; `NODE-SHAPE.md` §11b, §12–§12e | design sections cited as rules. §11–§12 are the stage-3 node-shape decisions recovered from the deleted `DESIGN-PATCH-CHANNEL.md` (see NODE-SHAPE.md for provenance) |",
  ""
);
L.push(
  "Status legend: **live** stated and standing · **ruled** carries an explicit ruling date · **amended** re-ruled or re-scoped in place (the row text says how) · **superseded** replaced by a later rule (the text names it) · **retired** mechanism removed, ID kept for citations · **fixed / resolved / closed** a violation or open item with its outcome · **ruled out** a design that was tried and rejected.",
  ""
);
const summary = {};
for (const r of rows) {
  const k = r.vocab === "R" ? `R (${r.ns})` : r.vocab;
  summary[k] ??= { n: 0, src: 0, tests: 0, uncited: 0 };
  summary[k].n++;
  if (cited.src.has(r.key)) summary[k].src++;
  if (cited.tests.has(r.key)) summary[k].tests++;
  if (!cited.src.has(r.key) && !cited.tests.has(r.key)) summary[k].uncited++;
}
L.push(
  "## Summary",
  "",
  "| vocabulary | rules | cited in src | cited in tests | cited nowhere |",
  "|---|---|---|---|---|"
);
for (const [k, v] of Object.entries(summary))
  L.push(`| ${k} | ${v.n} | ${v.src} | ${v.tests} | ${v.uncited} |`);
L.push("");
const un = unresolved("src"),
  unT = unresolved("tests");
L.push(
  "## Unresolved citations",
  "",
  un.length ? `**src/:** ${un.join(", ")}` : "**src/:** none — every citation resolves.",
  "",
  unT.length
    ? `**tests/:** ${unT.join(", ")} (test-only citations are informational; \`--check\` gates src/ only)`
    : "**tests/:** none.",
  ""
);
let cur = "";
for (const r of rows) {
  const section =
    r.vocab === "R"
      ? `R — ${Object.keys(NS).find(k => NS[k] === r.ns)} (\`${r.ns}-R<n>\`)`
      : {
          A: "A — spec propositions",
          V: "V — fixed violations",
          B: "B — tier B",
          C: "C — tier C",
          INV: "INV — invariants",
          RUL: "RUL — store rulings",
          "§": "§ — design sections"
        }[r.vocab];
  if (section !== cur) {
    cur = section;
    L.push(
      `## ${section}`,
      "",
      "| id | status | defined | cited in src | cited in tests | statement (at definition) |",
      "|---|---|---|---|---|---|"
    );
  }
  L.push(
    `| ${r.key} | ${r.status} | \`${r.def}\` | ${esc(fmtCites(cited.src.get(r.key)))} | ${esc(fmtCites(cited.tests.get(r.key)))} | ${esc(r.text.slice(0, 200))}${r.text.length > 200 ? "…" : ""} |`
  );
}
fs.writeFileSync(path.join(DOCS, "RULES-INDEX.md"), L.join("\n") + "\n");
console.log(
  `RULES-INDEX.md: ${rows.length} rules; src citations ${cited.src.size} ids (${un.length} unresolved); tests ${cited.tests.size} ids (${unT.length} unresolved)`
);
if (un.length) console.log("unresolved in src:", un.join(" "));
