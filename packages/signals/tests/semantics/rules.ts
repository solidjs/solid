import { type Scenario } from "./scenario.js";
import { Model, sameNumbers } from "./model.js";

export type Output = number[] | "hidden" | "loading" | "absent" | "covered" | { pending: boolean };
export interface Frame {
  at: string;
  input: number;
  inputs?: Record<number, number>;
  mounts?: Record<number, boolean>;
  show: boolean;
  outputs: Record<number, Output>;
}
export interface Failure {
  rule: string;
  message: string;
  reader?: number;
  frame?: Frame;
  expected?: unknown;
}
// Bump when the executable contract or completion policy changes. Target source
// hashes alone cannot explain a replay performed with different oracle rules.
export const ruleRevision = 17;
export const rules = [
  {
    id: "A1",
    law: "An initialized visible region keeps exactly one output contribution until replacement or explicit removal.",
    scope:
      "fixed ordinary output regions; visibility follows host attachment, not reactive ownership"
  },
  {
    id: "G1",
    law: "Proven update groups publish atomically and authoritative action holds prevent early publication.",
    scope:
      "ordinary initialized flat DAGs, complete anchors, fixed readers; generated batch/action identity and same-source overlap"
  },
  {
    id: "G2",
    law: "A group with no remaining conservative blocker publishes after a drain, independently of unrelated groups.",
    scope:
      "G1 scope; possible memo joins extend deadlines only; adjacent microtasks permit but do not require entanglement"
  },
  {
    id: "P1",
    law: "Ordinary writes publish after a drain when no visible reader still needs an unresolved answer.",
    scope:
      "flat ordinary pure DAG, complete source anchors, settled observation controls; no actions, branches or readiness readers; fallback is not a blocker"
  },
  {
    id: "R4",
    law: "A held ordinary change to an initialized expression's answer has a true tracked pending verdict.",
    scope:
      "continuous unconditional readiness readers; no boundary, mount or action; complete source anchors and distinct pure current/desired answers"
  },
  {
    id: "R2",
    law: "A control publishing ready can read its guarded expression without suspending, consistently with witnessed published inputs.",
    scope:
      "explicit generated clicks on tracked isPending readers; initialized ordinary or one-parent override graph; no context-free false-implies-readable claim"
  },
  {
    id: "R3",
    law: "Context-free isPending probes do not throw NotReadyError.",
    scope: "explicit event-block probes; SPEC A16; user errors are not generated"
  },
  {
    id: "E5",
    law: "A single optimistic proposal while its parent is held has the ordinary update's publication behavior.",
    scope:
      "settled pure graph, one write, unconditional readers, no boundaries; parent completion excluded"
  },
  {
    id: "S1",
    law: "Published pure values describe the same published input.",
    scope: "ordinary scalar pure DAG"
  },
  {
    id: "S2",
    law: "A published observation toggle agrees with its reader's ready/hidden view.",
    scope: "conditional readers; explicit fallback allowed"
  },
  {
    id: "S3",
    law: "All scoped write completions imply those inputs have published.",
    scope: "all generated setters; checked after flush, not at transitionSettled"
  },
  {
    id: "S4",
    law: "Residual obsolete or unobserved completion cannot corrupt a settled view.",
    scope: "no new external input; S1/S2 checked at every drain"
  },
  {
    id: "S5",
    law: "A disposed reader receives no later publication callback.",
    scope: "explicit disposal or cleanup of an owned reader generation"
  },
  {
    id: "L1",
    law: "All finite generated work settling reaches the final pure view.",
    scope: "no new external inputs; checked after residual completion"
  },
  {
    id: "W1",
    law: "Publication may wait only for work permitted by the selected policy.",
    scope: "unknown completion timing remains open; historical disposal allowance is opt-in"
  },
  {
    id: "E3",
    law: "Delayed pure answers permit waiting, not inconsistent data publications.",
    scope: "settled start, no intervening writes or fallback resets"
  },
  {
    id: "O1",
    law: "Ready observed optimistic derivations can publish while the parent action is open.",
    scope:
      "one parent; continuous initialized data readers and optimistic source anchor; no boundaries, mounts, gates or authoritative writes until final action step"
  },
  {
    id: "O2",
    law: "Authoritative completion does not require obsolete optimistic requests to settle first.",
    scope: "one parent; current required correction work has been settled"
  },
  {
    id: "R1",
    law: "Ordinary imperative reads describe published state.",
    scope:
      "explicit event-block reads outside action bodies; published witness; excludes getters and derivations that may read latest"
  },
  {
    id: "E4",
    law: "Warming latest without adding an observer does not change later observations.",
    scope: "paired identical schedules and readers; only companion creation differs"
  }
] as const;

export const ruleContracts = Object.fromEntries(
  rules.map(rule => [
    rule.id,
    {
      ...rule,
      authority:
        rule.id === "A1"
          ? "visible-output continuity; #3404 is a calibration case, not the definition of visibility"
          : rule.id === "G1" || rule.id === "G2"
            ? "proposed update-group model; batching/action controls plus effects-do-not-entangle ruling; adjacent-microtask entanglement permission"
            : rule.id === "P1"
              ? "ideal observational progress law; tested against #3375 and #3372, not defined by their implementation"
              : rule.id === "R4"
                ? "SPEC A24 maintainer ruling 2026-07-13: a new question pends until its answer reveals"
                : rule.id === "R3"
                  ? "SPEC A16 maintainer keep 2026-07-06; Ryan commit 70e89bafa7de4b6cbdb47aa83ac37b59244647d0"
                  : rule.id === "R2"
                    ? "proposed readiness-control contract; initialized tracked probe, not context-free initial load"
                    : rule.id === "W1"
                      ? "scoped timing investigation; P1 independently checks proven release, legacy disposal permission requires an explicit allowance"
                      : rule.id === "S3"
                        ? "ordinary scoped completion; experimental extension includes observed optimistic correction"
                        : rule.id.startsWith("O") || rule.id === "E5"
                          ? "experimental optimistic contract; upstream conformance not presumed"
                          : "semantic-fuzzing.md scoped law",
      checkpoints:
        rule.id === "A1"
          ? "completed flush and host drain; detached preparation and intermediate mutations within a flush are private"
          : rule.id === "G1"
            ? "complete publication checkpoints"
            : rule.id === "G2"
              ? "host drain"
              : rule.id === "P1"
                ? "host drain after each external turn and completion step"
                : rule.id === "R2" || rule.id === "R3" || rule.id === "R4"
                  ? "completed flush for R4; explicit event-block click or probe for R2/R3"
                  : rule.id === "L1"
                    ? "final completion"
                    : rule.id === "W1"
                      ? "required and retained completion"
                      : "publication or paired replay",
      controls:
        rule.id === "A1"
          ? "output.test.ts and attachment.test.ts; premature attachment, cleanup and duplicate-contribution controls"
          : rule.id === "G1" || rule.id === "G2"
            ? "group-controls.test.ts, groups.test.ts, entangle-effect/drop-action-hold calibration"
            : rule.id === "P1"
              ? "progress.test.ts and lost-disposal-wake/lost-fallback-wake calibration"
              : rule.id === "R2" || rule.id === "R3" || rule.id === "R4"
                ? "readiness.test.ts and pending-contract.test.ts"
                : rule.id === "W1" || rule.id === "L1"
                  ? "completion.test.ts"
                  : rule.id === "E5"
                    ? "optimistic-equivalence.test.ts"
                    : rule.id.startsWith("O")
                      ? "optimistic.test.ts and optimistic-scope.test.ts"
                      : rule.id === "R1" || rule.id === "E4"
                        ? "reads.test.ts"
                        : rule.id === "S3"
                          ? "settled-writes.test.ts and optimistic.test.ts"
                          : rule.id === "S2" || rule.id === "S5"
                            ? "runner.test.ts and mounts.test.ts"
                            : "runner.test.ts and calibration.test.ts"
    }
  ])
);

export function checkFrame(s: Scenario, frame: Frame, model = new Model(s)): Failure | undefined {
  const values = model.evaluate(frame.input, frame.inputs);
  for (const r of s.readers) {
    const output = frame.outputs[r.id];
    if (r.parent !== undefined) {
      const parent = frame.outputs[r.parent];
      const covered =
        parent === "loading" || parent === "covered" || parent === "hidden" || parent === "absent";
      if (covered !== (output === "covered"))
        return {
          rule: "S2",
          message: "Nested content disagrees with its enclosing region",
          reader: r.id,
          frame
        };
      if (covered) continue;
    } else if (output === "covered")
      return {
        rule: "S2",
        message: "Covered content without an enclosing region",
        reader: r.id,
        frame
      };
    if (r.mounted !== undefined && !!frame.mounts?.[r.id] !== (output !== "absent"))
      return {
        rule: "S2",
        message: "Published mount control disagrees with its owned reader",
        reader: r.id,
        frame
      };
    if (output === "absent") continue;
    if (output === "loading") {
      if (r.boundary === "none")
        return { rule: "S2", message: "Fallback without a boundary", reader: r.id, frame };
      continue;
    }
    const hidden = r.gated && !frame.show;
    if (s.anchorShow !== false && hidden !== (output === "hidden"))
      return {
        rule: "S2",
        message: "Published observation control disagrees with its reader",
        reader: r.id,
        frame
      };
    if (output === "hidden") continue;
    if (
      r.pending &&
      typeof output === "object" &&
      !Array.isArray(output) &&
      typeof output.pending === "boolean"
    )
      continue;
    let wrong = !Array.isArray(output) || output.length !== r.refs.length;
    if (Array.isArray(output))
      for (let i = 0; i < output.length && !wrong; i++)
        wrong = model.witnessed(r.refs[i]) && output[i] !== values.get(r.refs[i]);
    if (wrong)
      return {
        rule: "S1",
        message: "Published derivation disagrees with published input",
        reader: r.id,
        frame,
        expected: r.refs.map(ref => values.get(ref))
      };
  }
}

/** A24's new-question implication, deliberately one-way. A ready old answer
 * is readable, so R2 alone cannot detect a false verdict over a held change.
 * Compare pure answers only with complete publication witnesses, after flush.
 * Equal answers, partial anchors and changing observation remain outside this
 * implication; no reference copy of Solid's pending propagation is required. */
export function checkPending(
  s: Scenario,
  frame: Frame,
  desired: Record<number, number>,
  onSubject?: (reader: number) => void,
  model = new Model(s)
): Failure | undefined {
  if (!model.hasPending) return;
  const published = model.evaluate(frame.input, frame.inputs);
  const future = model.evaluate(desired[-1], desired);
  for (const reader of s.readers) {
    if (
      !reader.pending ||
      reader.gated ||
      reader.mounted !== undefined ||
      reader.boundary !== "none"
    )
      continue;
    const output = frame.outputs[reader.id];
    if (typeof output !== "object" || Array.isArray(output)) continue;
    for (const ref of reader.refs) {
      if (published.get(ref) === future.get(ref)) continue;
      if (model.witnessed(ref)) {
        onSubject?.(reader.id);
        if (output.pending) continue;
        return {
          rule: "R4",
          message: "Tracked verdict is false while a distinct ordinary answer is held",
          reader: reader.id,
          frame,
          expected: { pending: true, published: published.get(ref), desired: future.get(ref) }
        };
      }
    }
  }
}

/** O1 concerns ready optimistic data, not the completion of ordinary mount,
 * visibility, or authoritative updates sharing the action's lifetime. */
export function checkOptimistic(
  s: Scenario,
  frame: Frame,
  inputs: Record<number, number>,
  model = new Model(s)
): Failure | undefined {
  if (!s.optimistic) return;
  const values = model.evaluate(inputs[-1], inputs);
  if (model.anchors.includes(-2) && frame.inputs?.[-2] !== inputs[-2])
    return {
      rule: "O1",
      message: "Ready optimistic source did not publish while its parent action remained open",
      frame,
      expected: inputs[-2]
    };
  const optimisticMask = model.sourceMask(-2);
  for (const reader of s.readers) {
    if (
      reader.gated ||
      reader.mounted !== undefined ||
      reader.boundary !== "none" ||
      reader.pending
    )
      continue;
    const output = frame.outputs[reader.id];
    if (output === "absent") continue;
    for (let i = 0; i < reader.refs.length; i++) {
      const ref = reader.refs[i];
      if (!(model.sourceMask(ref) & optimisticMask)) continue;
      if (!Array.isArray(output) || output[i] !== values.get(ref))
        return {
          rule: "O1",
          message:
            "Ready optimistic derivation did not publish while its parent action remained open",
          reader: reader.id,
          frame,
          expected: { ref, value: values.get(ref) }
        };
    }
  }
}

export function checkFinal(
  s: Scenario,
  frame: Frame,
  input: number,
  show: boolean,
  inputs?: Record<number, number>,
  mounts?: Record<number, boolean>,
  model = new Model(s)
): Failure | undefined {
  const values = model.evaluate(input, inputs);
  if (
    (model.anchors.includes(-1) && frame.input !== input) ||
    (s.anchorShow !== false && frame.show !== show) ||
    (inputs && model.anchors.some(id => (frame.inputs?.[id] ?? frame.input) !== inputs[id]))
  )
    return {
      rule: "L1",
      message: "Final input or observation write did not publish",
      frame,
      expected: { input, show, ...(inputs ? { inputs } : {}) }
    };
  for (const r of s.readers) {
    if (r.mounted !== undefined) {
      const wanted = mounts?.[r.id] ?? r.mounted;
      if (!!frame.mounts?.[r.id] !== wanted || (frame.outputs[r.id] !== "absent") !== wanted)
        return {
          rule: "L1",
          message: "Owned reader did not publish its requested mount state",
          reader: r.id,
          frame,
          expected: wanted
        };
    }
    if (frame.outputs[r.id] === "absent") continue;
    const expected =
      r.gated && !show
        ? "hidden"
        : r.pending
          ? { pending: false }
          : r.refs.map(ref => values.get(ref)!);
    if (!sameOutput(frame.outputs[r.id], expected))
      return {
        rule: "L1",
        message: "Required reader did not publish its final answer",
        reader: r.id,
        frame,
        expected
      };
  }
}

export function sameOutput(a: Output, b: Output): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && sameNumbers(a, b);
  if (typeof a === "object" && typeof b === "object" && !Array.isArray(b))
    return a.pending === b.pending;
  return false;
}

/** Compare meaningful data publications, retaining every inconsistent frame. */
export function dataTrace(frames: Frame[]): string[] {
  const result: string[] = [];
  for (const { input, inputs, mounts, show, outputs } of frames) {
    const frame = JSON.stringify([
      input,
      show,
      outputs,
      ...(inputs ? [inputs] : []),
      ...(mounts ? [mounts] : [])
    ]);
    if (result.at(-1) !== frame) result.push(frame);
  }
  return result;
}
