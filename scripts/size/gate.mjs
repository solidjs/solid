// The size gate's decision: head (and, on a PR, base) results from size.mjs
// --json in, one verdict per scenario out.
//
// Caps are brotli bytes, and brotli is what ships, so a scenario under its
// cap passes whatever its minified size did. Over the cap is not enough to
// fail: brotli's layout moves ±50–90 B on minified changes of a few bytes.
// Each cap records the minified size measured when it was set
// (`capMinified`), and a scenario fails only when it is over its brotli cap
// AND its minified size exceeds that recorded size by more than
// MINIFIED_ALLOWANCE (or the scenario's `minifiedAllowance`). Over the cap
// within the allowance passes with a warning stating the headroom left.
// Measuring against the recorded size, not the PR's base, bounds growth
// across PRs: two +15 B PRs on an over-cap scenario cannot both pass.
//
// Fail-safe: a cap with no recorded minified falls back to the minified
// growth over the PR's base (the PR's base commit, or on a push to next the
// commit before it). Without that either (a new scenario, a base the head's
// harness could not measure, a local run) the cap is absolute.
//
// Usage: node gate.mjs <head.json> [base.json]
//   Exits non-zero when any scenario fails. In GitHub Actions each warning
//   and failure is also emitted as an annotation.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Minified bytes a PR may add to an over-cap scenario before brotli growth
// counts as real. Minified is the deterministic unit; brotli is not.
export const MINIFIED_ALLOWANCE = 20;

const signed = d => `${d >= 0 ? "+" : "−"}${Math.abs(d)} B`;
const bytes = n => `${n.toLocaleString("en-US")} B`;
const REAL_GROWTH =
  "real growth: reduce it, or raise the cap and its recorded minified in this PR with a reason (frozen floors need `Size-Exception:`)";

/**
 * One scenario's verdict. `against` says what the minified size was judged
 * against: the minified recorded with the cap, or (fail-safe) the base.
 * @returns {{ name: string, verdict: "pass" | "warn" | "fail",
 *   against?: "recorded" | "base" | "none", overBy?: number, minDelta?: number,
 *   baseDelta?: number, headroom?: number, allowance?: number, message: string }}
 */
export function decide(head, base) {
  const { name } = head;
  if (head.error) return { name, verdict: "fail", message: `failed to bundle: ${head.error}` };
  if (head.size <= head.limit) return { name, verdict: "pass", message: "within its cap" };
  const overBy = head.size - head.limit;
  const allowance = head.minifiedAllowance ?? MINIFIED_ALLOWANCE;
  const hasBase = base && !base.error && typeof base.minified === "number";
  const baseDelta = hasBase ? head.minified - base.minified : undefined;
  const thisPR = hasBase ? `; ${signed(baseDelta)} minified over this PR's base` : "";

  if (typeof head.capMinified === "number") {
    const minDelta = head.minified - head.capMinified;
    const headroom = allowance - minDelta;
    const vs = `minified ${bytes(head.minified)} vs ${bytes(head.capMinified)} recorded with the cap (${signed(minDelta)})`;
    const common = { name, against: "recorded", overBy, minDelta, baseDelta, headroom, allowance };
    if (headroom >= 0)
      return {
        ...common,
        verdict: "warn",
        message: `over brotli cap by ${overBy} B; ${vs} — ${headroom} B of the ${allowance} B minified allowance left${thisPR}`
      };
    return {
      ...common,
      verdict: "fail",
      message: `over brotli cap by ${overBy} B; ${vs} — ${-headroom} B past the ${allowance} B minified allowance${thisPR}. ${REAL_GROWTH}`
    };
  }

  if (!hasBase)
    return {
      name,
      verdict: "fail",
      against: "none",
      overBy,
      allowance,
      message: `over brotli cap by ${overBy} B; no minified recorded with the cap and no base measurement to compare against`
    };
  const headroom = allowance - baseDelta;
  const common = {
    name,
    against: "base",
    overBy,
    minDelta: baseDelta,
    baseDelta,
    headroom,
    allowance
  };
  const vs = `no minified recorded with the cap, so judged against this PR's base: minified ${signed(baseDelta)}`;
  if (headroom >= 0)
    return {
      ...common,
      verdict: "warn",
      message: `over brotli cap by ${overBy} B; ${vs} — ${headroom} B of the ${allowance} B minified allowance left`
    };
  return {
    ...common,
    verdict: "fail",
    message: `over brotli cap by ${overBy} B; ${vs} — ${-headroom} B past the ${allowance} B minified allowance. ${REAL_GROWTH}`
  };
}

/** Verdicts for every head scenario, each matched to its base by name. */
export function decideAll(head, base = []) {
  return head.map(h =>
    decide(
      h,
      base.find(b => b.name === h.name)
    )
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [headFile, baseFile] = process.argv.slice(2);
  if (!headFile) {
    console.error("usage: node gate.mjs <head.json> [base.json]");
    process.exit(2);
  }
  const head = JSON.parse(readFileSync(headFile, "utf8"));
  let base = [];
  if (baseFile) {
    try {
      base = JSON.parse(readFileSync(baseFile, "utf8"));
    } catch {
      console.log(`gate: no base measurement at ${baseFile}; every cap is absolute.`);
    }
  }
  const verdicts = decideAll(head, base);
  const annotate = !!process.env.GITHUB_ACTIONS;
  // Workflow-command escaping: scenario names carry `,` and `:`.
  const data = s => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const prop = s => data(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  for (const v of verdicts) {
    const tag = v.verdict === "pass" ? "ok  " : v.verdict === "warn" ? "WARN" : "FAIL";
    console.log(`${tag} ${v.name}${v.verdict === "pass" ? "" : `\n     ${v.message}`}`);
    if (annotate && v.verdict !== "pass")
      console.log(
        `::${v.verdict === "warn" ? "warning" : "error"} title=${prop(`size: ${v.name}`)}::${data(v.message)}`
      );
  }
  const fallback = verdicts.filter(v => v.against === "base" || v.against === "none");
  if (fallback.length)
    console.log(
      `\ngate: ${fallback.length} over-cap scenario(s) have no minified recorded with the cap; ` +
        "judged against the base instead (fail-safe)."
    );
  const failed = verdicts.some(v => v.verdict === "fail");
  const warned = verdicts.filter(v => v.verdict === "warn").length;
  console.log(
    failed
      ? "\nsize: a scenario grew past its cap (or failed to bundle)."
      : `\nsize: every scenario passes${warned ? ` (${warned} over its brotli cap within the minified allowance)` : ""}.`
  );
  process.exit(failed ? 1 : 0);
}
