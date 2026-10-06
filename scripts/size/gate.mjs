// The size gate's decision: head (and, on a PR, base) results from size.mjs
// --json in, one verdict per scenario out.
//
// Caps are brotli bytes, and brotli is what ships, so a scenario under its
// cap passes whatever its minified size did. Over the cap is not enough to
// fail: brotli's layout moves ±50–90 B on minified changes of a few bytes, so
// a PR fails a scenario only when it is over its brotli cap AND its minified
// growth over the PR's base exceeds MINIFIED_ALLOWANCE (or the scenario's
// `minifiedAllowance`). Over the cap within the allowance passes with a
// warning — layout noise, left for the next ratchet (ratchet.mjs) to re-base.
// The base is the PR's base commit, or on a push to next the commit before
// it. Without a base measurement (a new scenario, a base the head's harness
// could not measure, a local run) the cap is absolute, as it always was.
//
// Usage: node gate.mjs <head.json> [base.json]
//   Exits non-zero when any scenario fails. In GitHub Actions each warning
//   and failure is also emitted as an annotation.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Minified bytes a PR may add to an over-cap scenario before brotli growth
// counts as real. Minified is the deterministic unit; brotli is not.
export const MINIFIED_ALLOWANCE = 20;

/**
 * One scenario's verdict.
 * @returns {{ name: string, verdict: "pass" | "warn" | "fail", overBy?: number,
 *   minDelta?: number, allowance?: number, message: string }}
 */
export function decide(head, base) {
  const { name } = head;
  if (head.error) return { name, verdict: "fail", message: `failed to bundle: ${head.error}` };
  if (head.size <= head.limit) return { name, verdict: "pass", message: "within its cap" };
  const overBy = head.size - head.limit;
  const allowance = head.minifiedAllowance ?? MINIFIED_ALLOWANCE;
  if (!base || base.error || typeof base.minified !== "number")
    return {
      name,
      verdict: "fail",
      overBy,
      allowance,
      message: `over brotli cap by ${overBy} B, no base measurement to compare minified growth against`
    };
  const minDelta = head.minified - base.minified;
  const signed = `${minDelta >= 0 ? "+" : "−"}${Math.abs(minDelta)} B`;
  if (minDelta <= allowance)
    return {
      name,
      verdict: "warn",
      overBy,
      minDelta,
      allowance,
      message: `over brotli cap by ${overBy} B, minified ${signed} — layout noise; cap will be re-based at the next ratchet`
    };
  return {
    name,
    verdict: "fail",
    overBy,
    minDelta,
    allowance,
    message: `over brotli cap by ${overBy} B, minified ${signed} (allowance ${allowance} B) — real growth: reduce it, or raise the cap in this PR with a reason (frozen floors need \`Size-Exception:\`)`
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
  const failed = verdicts.some(v => v.verdict === "fail");
  const warned = verdicts.filter(v => v.verdict === "warn").length;
  console.log(
    failed
      ? "\nsize: a scenario grew past its cap (or failed to bundle)."
      : `\nsize: every scenario passes${warned ? ` (${warned} over its brotli cap within the minified allowance)` : ""}.`
  );
  process.exit(failed ? 1 : 0);
}
