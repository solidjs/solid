import { Model } from "./model.js";
import type { Scenario } from "./scenario.js";
import type { Failure, Frame } from "./rules.js";
import type { Requirement } from "./runner.js";

/** No reconstruction of transaction ownership: this sufficient condition is
 * deliberately limited to ordinary flat data readers with complete anchors.
 * Readiness, actions, branches and unsettled mounting need separate contracts. */
export function progressScope(s: Scenario, model: Model): boolean {
  return (
    !s.optimistic &&
    !s.actions &&
    !s.nodes.some(n => n.branch) &&
    !s.readers.some(r => r.pending || r.parent !== undefined || r.render) &&
    model.anchorMask === (1 << model.sources.length) - 1
  );
}

/** Called after a host drain, NOT inside an individual flush callback. Fallback
 * work still belongs to the boundary, but does not hold these ordinary writes.
 * Unknown observation topology or a live unresolved demand prevents this proof. */
export function checkProgress(
  s: Scenario,
  frame: Frame,
  desired: Record<number, number>,
  wantedShow: boolean,
  wantedMounts: Record<number, boolean>,
  requirements: Requirement[],
  model: Model
): Failure | undefined {
  for (const reader of s.readers) {
    const output = frame.outputs[reader.id];
    if (reader.mounted !== undefined && frame.mounts?.[reader.id] !== wantedMounts[reader.id])
      return;
    if (output === "absent") continue;
    if (reader.gated && (s.anchorShow === false || frame.show !== wantedShow)) return;
    if (output === "hidden") {
      if (!reader.gated || wantedShow) return;
      continue;
    }
    if (output === "loading" && reader.boundary !== "none") continue;
    if (!Array.isArray(output)) return;
  }
  for (const r of requirements)
    if (r.gate !== "resolved" && Array.isArray(frame.outputs[r.reader])) return;
  let changed = s.anchorShow !== false && frame.show !== wantedShow;
  for (const id of model.sources)
    if ((frame.inputs?.[id] ?? frame.input) !== desired[id]) changed = true;
  if (!changed) return;
  return {
    rule: "P1",
    message: "Ordinary writes remain unpublished after all visible blocking demands have ended",
    frame,
    expected: { inputs: { ...desired }, show: wantedShow }
  };
}
