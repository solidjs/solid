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
  /** S1 in flight: nodes whose answer for this frame's published inputs is
   * still in flight, each with the answers it has produced (landings of its
   * newest question). A reader of such a node directly may show one of them. */
  inflight?: Record<number, number[]>;
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
// Revision 18 (2026-10-05, L2 — #3774 "the hold model"): R1/R2 exclude direct
// reads that derive from a held optimistic override (SPEC A17: "direct read
// shows optimistic, effect waits"); S5 fires on a generation whose cleanup ran,
// not on one merely replaced by its parent's re-pass (ruling A, #3698); G1/G2's
// proven batch is the tick — the writes one flush settles (A34 (1)), closed at
// `flushEnd`, not at a callback boundary.
// Revision 19 (2026-10-05, the lane-membership ruling — F8): S1 lets a reader
// that reads an async node directly show an answer the node has produced while
// its answer for the published inputs is in flight (a stale reader of the
// lane, SPEC "A lane's readers are placed by the screen"); it must agree once
// that flight lands. A derivation in between (a sync node) is not exempt, and
// neither is an answer that landed for a superseded question.
// Revision 20 (2026-10-06, the RC exit gate): adds MH1–MH7 for the
// `mount-under-hold` cohort only (A29; the 2026-10-06 boundary-scope and
// direction rulings; the lane rule, #3835). No law or scope of another cohort
// changed: a revision-19 run and a revision-20 run of any other cohort judge
// identically.
// Revision 21 (2026-10-06, the outside-read ruling): a boundary shows its own
// fallback for a source only when nothing outside it reads that source (or
// anything in the same transition). A committed outside read holds the
// transition: a fresh mount stays closed and a re-armed boundary keeps its old
// content (MH8) until the hold releases; only then may content still loading
// show the inner fallback. MH1 is narrowed to shapes with no outside read, and
// the cohort gains cases without the screen anchor (`anchor: false`). Verdict
// mounts become unruled. Other cohorts judge identically.
// Revision 22 (2026-10-06, maintainer answer): a `latest()` read is not an
// outside read that holds. A verdict-lane mount of a new Loading is judged by
// the other reads present — MH8 with the committed anchor, MH1 without — and
// is ruled again. Cases keep their fields; other families and cohorts judge
// identically.
export const ruleRevision = 22;
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
      "ordinary initialized flat DAGs, complete anchors, fixed readers; generated batch/action identity and same-source overlap; a batch is the tick (every write before the flush that settles it, L2 A34 (1))"
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
      "explicit generated clicks on tracked isPending readers; initialized ordinary or one-parent override graph; no context-free false-implies-readable claim; a ref deriving from a held override is read display-ahead (A17) and is not compared"
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
    scope:
      "explicit disposal or cleanup of an owned reader generation; a generation replaced by its parent's re-pass is live until its cleanup runs (L2 ruling A, #3698)"
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
      "explicit event-block reads outside action bodies; published witness; excludes getters and derivations that may read latest, and those deriving from a held optimistic override (A17)"
  },
  {
    id: "E4",
    law: "Warming latest without adding an observer does not change later observations.",
    scope: "paired identical schedules and readers; only companion creation differs"
  },
  {
    id: "MH1",
    law: "A loading boundary that has not shown content, or that an `on` change re-armed, shows its own fallback for what its content waits on when nothing outside it reads that source or its transition (an uncommitted outside read's own catcher shows instead); once an outside hold releases, content still loading shows the boundary's fallback.",
    scope:
      "mount-under-hold cohort: a new Loading mounted by a flip, a mainline root or a `latest()` condition (a `latest()` read is not an outside read that holds), a re-armed revealed Loading, or a boundary that appeared at a hold's commit, with no committed outside read of the held source while it is held; at the release, any of these with a first load of its own; same-tick flips excluded"
  },
  {
    id: "MH2",
    law: "Content that waited for a hold reveals at the hold's commit; a boundary mounted as part of a hold appears at that hold's commit.",
    scope: "mount-under-hold cohort; content without a first load of its own"
  },
  {
    id: "MH3",
    law: "A hold never waits on never-committed work a boundary owns, nor on a loading source created before it.",
    scope:
      "mount-under-hold cohort: content with its own first load under a boundary that owns it; a revealed boundary under an outer one pending on a pre-hold first load. In-flush mounts with no catcher are excluded (SPEC 'Not yet one-way', recorded, not ruled)"
  },
  {
    id: "MH4",
    law: "Never-committed work with no catcher stays hidden with the hold it read; a mount that is part of a hold does not appear before the hold's commit.",
    scope:
      "mount-under-hold cohort: a Show mount under no boundary or a revealed one, and a Show whose condition reads the held value; a render effect reading the held value directly is a stale reader (A15) and excluded"
  },
  {
    id: "MH5",
    law: "No tearing: a control and its content, and an element and its bindings, are never observed in different worlds; visible content agrees with the screen (a lane's: the screen plus its own guesses).",
    scope: "mount-under-hold cohort; every checkpoint, every shape"
  },
  {
    id: "MH6",
    law: "An optimistic mount's children and runs are the lane's: the element and its bindings land together now, seeing the screen plus the lane's own guesses, and re-derive at the landing.",
    scope:
      "mount-under-hold cohort, lane family (#3835): createOptimistic + Show over an action's held write"
  },
  {
    id: "MH7",
    law: "Once every hold and first load settles, the mount shows the final value.",
    scope: "mount-under-hold cohort; every shape"
  },
  {
    id: "MH8",
    law: "Committed work outside a boundary that reads the held source holds the transition: content inside waits with it, a re-armed boundary keeps its old content and a fresh mount stays closed, and the inner boundary does not show its fallback while that hold is open.",
    scope:
      "mount-under-hold cohort: a new Loading mounted by a flip, a mainline root or a `latest()` condition, or a re-armed revealed Loading, with the screen anchor (a committed render effect reading the held source) outside it; same-tick flips excluded"
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
                        : rule.id.startsWith("MH")
                          ? "maintainer rulings: SPEC A29, the 2026-10-06 boundary-scope ruling (#3540) and its outside-read amendment, the 2026-10-06 direction rule, the lane rule (#3835); shapes they do not decide are listed by mount-hold.ts unruled()"
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
              ? "progress.test.ts and lost-disposal-wake calibration (lost-fallback-wake retired with L2)"
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
                            : rule.id.startsWith("MH")
                              ? "mount-hold.test.ts"
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
        wrong =
          model.witnessed(r.refs[i]) &&
          output[i] !== values.get(r.refs[i]) &&
          !frame.inflight?.[r.refs[i]]?.includes(output[i]);
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
