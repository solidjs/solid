/**
 * Differential mode: one build records every case's trace (each screen, the
 * final screen, the laws it broke), another replays the same seed and fails
 * on any difference. The gate for a rewrite that must not change behaviour:
 *
 *   ASYNC_GEN_RECORD=/tmp/next.json   (on the reference build)
 *   ASYNC_GEN_DIFF=/tmp/next.json     (on the candidate build, same seed and cases)
 *
 * Both campaigns (client: campaign.spec.ts, hydration: hydrate.spec.tsx)
 * take the two variables; a difference names the case, the first screen
 * that differs and both sides.
 */
import { readFileSync, writeFileSync } from "node:fs";

export type Trace = { screens: string[]; final: string; laws: string[] };
type Recording = { kind: string; seed: number; cases: number; traces: Record<number, Trace> };

const RECORD = process.env.ASYNC_GEN_RECORD;
const DIFF = process.env.ASYNC_GEN_DIFF;
export const differential = !!(RECORD || DIFF);

/** Writes the recording, or returns every difference from it (empty when
 * recording or when the traces match). */
export function recordOrDiff(
  kind: string,
  seed: number,
  cases: number,
  traces: Record<number, Trace>
): string[] {
  if (RECORD) {
    writeFileSync(RECORD, JSON.stringify({ kind, seed, cases, traces } satisfies Recording));
    return [];
  }
  if (!DIFF) return [];
  const ref = JSON.parse(readFileSync(DIFF, "utf8")) as Recording;
  if (ref.kind !== kind || ref.seed !== seed || ref.cases !== cases)
    return [
      `the recording is ${ref.kind} seed ${ref.seed} × ${ref.cases}, this run ${kind} seed ${seed} × ${cases}`
    ];
  const out: string[] = [];
  for (const i of new Set([...Object.keys(ref.traces), ...Object.keys(traces)].map(Number))) {
    const [a, b] = [ref.traces[i], traces[i]];
    if (!a || !b) {
      out.push(`#${i}: ${a ? "missing in this run" : "missing in the recording"}`);
      continue;
    }
    const at = a.screens.findIndex((x, j) => x !== b.screens[j]);
    if (at >= 0 || a.screens.length !== b.screens.length)
      out.push(
        `#${i} screen ${at >= 0 ? at : a.screens.length}: ${a.screens[at] ?? "(none)"}  →  ${b.screens[at] ?? "(none)"}`
      );
    else if (a.final !== b.final) out.push(`#${i} final: ${a.final}  →  ${b.final}`);
    else if (a.laws.join() !== b.laws.join()) out.push(`#${i} laws: [${a.laws}]  →  [${b.laws}]`);
  }
  return out;
}
