/**
 * Renders a ruling to its `SCENARIOS.md` block (between
 * `<!-- ruling:S-n -->` and `<!-- /ruling -->`), in the document's vocabulary:
 * a code block for the scenario, one table row per frame, the ✗ rows last.
 * Pure: no DOM, no runtime. `rulings.spec.ts` feeds it the observed results
 * (for the settle labels and, for a ruled-not-built case, today's screen).
 */
import type { Node, Read, Scenario, SrcRef, Step, Write } from "../scenario.js";
import type { Result } from "../run.js";
import type { Case, Ruling } from "./types.js";

export const START = (id: string) => `<!-- ruling:${id} -->`;
export const END = "<!-- /ruling -->";

// ── names ────────────────────────────────────────────────────

const refKey = (r: SrcRef) => `${r.k}${r.i}`;
const nameOf = (names: Record<string, string>, r: SrcRef) => names[refKey(r)] ?? refKey(r);
const setterOf = (n: string) => `set${n[0].toUpperCase()}${n.slice(1)}`;
const FALLBACK: Record<string, string> = {
  L: "[fallback]",
  "ROOT-L": "[root fallback]",
  E: "[error]",
  "ROOT-E": "[root error]",
  F: "[none]"
};

function readText(r: Read, names: Record<string, string>): string {
  const n = nameOf(names, r.src);
  return r.how === "plain"
    ? `${n}()`
    : r.how === "latest"
      ? `latest(${n})`
      : r.how === "pending"
        ? `isPending(${n})`
        : `isPending(() => latest(${n}))`;
}

// ── screens ──────────────────────────────────────────────────

const TOKEN = /\[(ROOT-)?([LEF])\]|([vlpq])([sm]\d+):([^ <]*)/g;

/** `<span data-a0=pm3:true >vm0:1 </span>[L]` → `` `fast 1 | isPending(both) true | [fallback]` ``. */
export function screenText(raw: string, names: Record<string, string>): string {
  const out: string[] = [];
  for (const m of raw.matchAll(TOKEN)) {
    if (m[2]) out.push(names[m[2]] ?? FALLBACK[(m[1] ?? "") + m[2]]);
    else {
      const n = names[m[4]] ?? m[4];
      const label =
        m[3] === "l"
          ? `latest(${n})`
          : m[3] === "p"
            ? `isPending(${n})`
            : m[3] === "q"
              ? `isPending(() => latest(${n}))`
              : n;
      out.push(`${label} ${m[5]}`);
    }
  }
  return out.length ? "`" + out.join(" | ") + "`" : "`(empty)`";
}

// ── the scenario as source ───────────────────────────────────

function depText(
  d: { src: SrcRef; how: string; when?: SrcRef },
  names: Record<string, string>
): string {
  const n = nameOf(names, d.src);
  const read =
    d.how === "latest" ? `latest(${n})` : d.how === "pending" ? `isPending(${n})` : `${n}()`;
  return d.when ? `(${nameOf(names, d.when)}() ? ${read} : 0)` : read;
}

function nodeLines(n: Node, names: Record<string, string>, indent: string): string[] {
  switch (n.t) {
    case "leaf": {
      const text = n.text.map(r => `{${readText(r, names)}}`).join(" ");
      const attrs = n.attrs.map((r, j) => ` data-a${j}={${readText(r, names)}}`).join("");
      const tag = n.attrs.length
        ? `<span${attrs}>${text}</span>${n.grouped ? " {/* one effect */}" : " {/* one effect per attribute */}"}`
        : `<span>${text}</span>`;
      return [indent + tag];
    }
    case "loading":
      return [
        `${indent}<Loading fallback="[fallback]"${n.on ? ` on={[${n.on.map(r => readText(r, names)).join(", ")}]}` : ""}>`,
        ...nodeLines(n.child, names, indent + "  "),
        `${indent}</Loading>`
      ];
    case "errored":
      return [
        `${indent}<Errored fallback="[error]">`,
        ...nodeLines(n.child, names, indent + "  "),
        `${indent}</Errored>`
      ];
    case "show":
      return [
        `${indent}<Show when={${readText(n.when, names)}}${n.fallback ? ' fallback="[none]"' : ""}>${n.owns?.length ? ` {/* creates ${n.owns.map(i => names[`m${i}`] ?? `m${i}`).join(", ")} when it opens */}` : ""}`,
        ...nodeLines(n.child, names, indent + "  "),
        `${indent}</Show>`
      ];
    case "group":
      return n.kids.flatMap(k => nodeLines(k, names, indent));
  }
}

export function describeTsx(sc: Scenario, names: Record<string, string>): string {
  const lines: string[] = [];
  sc.signals.forEach((v, i) => {
    const n = names[`s${i}`] ?? `s${i}`;
    lines.push(
      `const [${n}, ${setterOf(n)}] = ${sc.optimistic?.includes(i) ? "createOptimistic" : "createSignal"}(${v});`
    );
  });
  sc.memos.forEach((m, i) => {
    const n = names[`m${i}`] ?? `m${i}`;
    const body = m.deps.length ? `1 + ${m.deps.map(d => depText(d, names)).join(" + ")}` : "1";
    const poison = m.poison !== null ? ` // throws when the input % 4 === ${m.poison}` : "";
    const ctor = m.optimistic ? "createOptimistic" : "createMemo";
    const lhs = m.optimistic ? `const [${n}, ${setterOf(n)}]` : `const ${n}`;
    lines.push(
      m.async
        ? `${lhs} = ${ctor}(async () => fetch(${body}));${poison}`
        : `${lhs} = ${ctor}(() => ${body});${poison}`
    );
  });
  lines.push(...nodeLines(sc.tree, names, ""));
  return lines.join("\n");
}

// ── steps as actions ─────────────────────────────────────────

const writeText = (w: Write, names: Record<string, string>) =>
  "s" in w
    ? `${setterOf(names[`s${w.s}`] ?? `s${w.s}`)}(${w.v})`
    : `${setterOf(nameOf(names, w.o))}(${w.v})`;

function stepText(st: Step, names: Record<string, string>, settledLabel: string | null): string {
  switch (st.t) {
    case "write":
      return `${setterOf(names[`s${st.s}`] ?? `s${st.s}`)}(${st.v})`;
    case "action": {
      if ("s" in st) return `${setterOf(names[`s${st.s}`] ?? `s${st.s}`)}(${st.v}) in an action`;
      const parts = [st.before.map(w => writeText(w, names)).join(", ")];
      if (st.after?.length) parts.push(`then ${st.after.map(w => writeText(w, names)).join(", ")}`);
      if (st.refresh?.length)
        parts.push(`refresh(${st.refresh.map(i => names[`m${i}`] ?? `m${i}`).join(", ")})`);
      return `action${st.sync ? " (no yield)" : ""}: ${parts.join("; ")}`;
    }
    case "guess":
      return `${writeText({ o: st.o, v: st.v }, names)} (a guess)`;
    case "refresh":
      return `refresh(${names[`m${st.m}`] ?? `m${st.m}`})`;
    case "settle":
      return settledLabel ? `${flightText(settledLabel, names)} lands` : "nothing to settle";
    case "flush":
      return "flush()";
    case "micro":
      return "microtask";
    case "task":
      return "tick";
  }
}

/** `m0:2` → `fast(2)`; `act:s0=1` → `the action`. */
function flightText(label: string, names: Record<string, string>): string {
  const m = /^m(\d+):(\d+)$/.exec(label);
  if (m) return `${names[`m${m[1]}`] ?? `m${m[1]}`}(${m[2]})`;
  if (label.startsWith("act")) return "the action";
  return label;
}

/** The Action column between the previous frame and this one. */
export function actionText(
  sc: Scenario,
  from: number,
  to: number,
  names: Record<string, string>,
  settles: (string | null)[]
): string {
  const parts: string[] = [];
  for (let i = from; i <= to; i++) parts.push(stepText(sc.steps[i], names, settles[i] ?? null));
  return parts.join("; ");
}

// ── the block ────────────────────────────────────────────────

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function tableFor(
  r: Ruling,
  c: Case,
  observed: Result | undefined,
  status: Ruling["status"]
): string[] {
  const names = r.names;
  const rows: string[][] = [];
  let prev = -1;
  let prevScreen = "";
  let n = 0;
  for (const f of c.frames) {
    const after = f.after === "render" ? -1 : f.after;
    const action =
      f.after === "render"
        ? "render"
        : actionText(c.scenario, prev + 1, after, names, observed?.settles ?? []);
    const screen = f.screen === "—" ? "—" : screenText(f.screen, names);
    if (f.screen !== "—") prevScreen = f.screen;
    rows.push([String(n), action, screen, f.note ?? ""]);
    prev = after;
    n++;
  }
  for (const x of c.forbid ?? [])
    rows.push(["✗", "", `after ${frameIndex(c, x.after)}: ${screenText(x.screen, names)}`, x.why]);
  if (status === "ruled-not-built" && observed) {
    // Today's screen at every ruled frame it differs from ("—" resolved), so
    // the block records the gap and goes stale when a fix closes it.
    let want = "";
    for (const f of c.frames) {
      if (f.screen !== "—") want = f.screen;
      if (f.after === "render") continue;
      const got = observed.screens[f.after + 1];
      const listed = (c.forbid ?? []).some(x => x.after === f.after && x.screen === got);
      if (got !== want && !listed)
        rows.push([
          "✗",
          "",
          `today, after ${frameIndex(c, f.after)}: ${screenText(got ?? "", names)}`,
          "not yet built — the frames test is `it.fails`"
        ]);
    }
  }
  void prevScreen;
  const header = ["#", "Action", "Screen", "Notes"];
  const all = [header, ...rows];
  const widths = header.map((_, j) => Math.max(...all.map(row => cell(row[j]).length)));
  const line = (row: string[]) =>
    "| " + row.map((v, j) => cell(v).padEnd(widths[j])).join(" | ") + " |";
  return [
    line(header),
    "| " + widths.map(w => "-".repeat(Math.max(3, w))).join(" | ") + " |",
    ...rows.map(line)
  ];
}

/** The table row number a step index falls in (for ✗ rows). */
function frameIndex(c: Case, after: number): number {
  let n = -1;
  for (const f of c.frames) {
    n++;
    if (f.after !== "render" && f.after >= after) return n;
  }
  return n;
}

export function renderRuling(r: Ruling, observed: (Result | undefined)[]): string {
  const lines: string[] = [];
  lines.push(
    `### ${r.id}. ${r.title} — ${r.rules.join(", ")}${r.issues?.length ? ` (${r.issues.join(", ")})` : ""}`
  );
  lines.push("");
  const pins = r.pins?.length ? ` Pins also: ${r.pins.map(p => `\`${p}\``).join(", ")}.` : "";
  lines.push(
    `_Generated from \`packages/web/test/async-gen/rulings/${r.id}.ts\` (\`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings\` in \`packages/web\`); do not edit inside the markers. Status: ${r.status}.${pins}_`
  );
  r.cases.forEach((c, k) => {
    lines.push("");
    if (r.cases.length > 1) lines.push(`**Case ${c.label || k + 1}.**`, "");
    lines.push("```tsx", describeTsx(c.scenario, r.names), "```", "");
    lines.push(...tableFor(r, c, observed[k], c.status ?? r.status));
    if (c.allow?.length)
      lines.push("", `_Expected findings: ${c.allow.map(l => `\`${l}\``).join(", ")}._`);
    if (c.note) lines.push("", c.note);
  });
  if (r.prose) lines.push("", r.prose);
  return lines.join("\n");
}

/** Replace the block for `id` in `md`; throws when the markers are missing. */
export function replaceBlock(md: string, id: string, block: string): string {
  const re = new RegExp(`${escapeRe(START(id))}[\\s\\S]*?${escapeRe(END)}`);
  if (!re.test(md)) throw new Error(`${id}: no marker pair in SCENARIOS.md`);
  return md.replace(re, () => `${START(id)}\n${block}\n${END}`);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Prettier reflows tables and escapes, and formats the TSX code blocks
 * (semicolons, trailing commas, quotes, wrapping); compare with whitespace,
 * backslashes, emphasis markers, statement punctuation and quotes removed and
 * dash runs collapsed (as `rules-index.mjs` does for its tables). */
export const norm = (t: string) => t.replace(/[\s\\*_;,'"`]+/g, "").replace(/-+/g, "-");
