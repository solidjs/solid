import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createOptimistic,
  action,
  latest,
  isPending,
  NotReadyError,
  onCleanup,
  flush,
  onSettled
} from "../../src/index.js";
import {
  attrHooks,
  setAttributionHooks,
  type AttributionHooks
} from "../../src/core/attribution-hooks.js";
import { Groups, groupScope } from "./groups.js";
import { canonicalize } from "./reduce.js";
import { HostTasks } from "./host.js";
import { checkProgress, progressScope } from "./progress.js";
import { Model, sameNumbers } from "./model.js";
import { mountTree, type TreeHost } from "./tree.js";
import { OutputTree, mountOutput, checkAttachment } from "./output.js";
import { Footprint, type Witness } from "./footprints.js";
import {
  capture,
  answer,
  queuedSteps,
  validate,
  type ReaderSpec,
  type Leaf,
  type Scenario,
  type Step
} from "./scenario.js";
import {
  checkFinal,
  checkOptimistic,
  checkFrame,
  checkPending,
  type Failure,
  type Frame,
  type Output
} from "./rules.js";
import {
  retainedObservations,
  progressAllowance,
  type Allowance,
  type ProgressFinding,
  type Observation,
  type WaitingFinding,
  type WaitingPolicy
} from "./policy.js";

interface Work {
  key: string;
  node: number;
  inputs: number[];
  value: number;
  state: "waiting" | "resolved";
  registered: boolean;
  observations: Observation[];
  resolve: () => void;
}
export interface Requirement {
  key?: string; // exact flight; absent when the desired request has not started
  reader: number;
  node: number;
  inputs: number[];
  gate: "missing" | "waiting" | "resolved";
  fallback: boolean;
  basis: "desired" | "fallback-retained";
  witness?: Witness;
  boundary?: number; // enclosing published fallback covering a nested reader
}
export interface RunResult {
  status: "pass" | "fail" | "policy" | "inapplicable" | "invalid" | "limit" | "error";
  failure?: Failure;
  waiting?: WaitingFinding;
  progress?: ProgressFinding[];
  actionScripts?: Array<{
    id: number;
    started: boolean;
    ended: boolean;
    segment: number;
    waiting: boolean;
  }>;
  groups?: {
    scope?: string;
    events: string[];
    checks: number;
    held: number;
    possibleJoins: number;
    batchingHeld: number;
  };
  attachment?: { nodes: number; privateWrites: number; visibleWrites: number; checks: number };
  reads?: Array<{
    at: string;
    ref: number;
    mode: "plain" | "latest" | "pending";
    verdict?: boolean;
    value?: number;
    pending?: boolean;
  }>;
  warmup?: { requests: number; pending: boolean };
  action?: {
    started: boolean;
    bodyCompleted: boolean;
    gates: Array<{ step: number; state: "waiting" | "resolved" }>;
  };
  error?: string;
  diagnostics?: string;
  cleanupError?: string;
  clicks?: Array<{ at: string; reader: number; values?: number[]; pending?: boolean }>;
  frames: Frame[];
  scenario: Scenario;
  requirements: Requirement[];
  footprints?: Array<{ reader: number; requested: number[]; published?: number[] }>;
  work: Array<Omit<Work, "resolve">>;
  coverage: string[];
  metrics: {
    operations: number;
    skipped: number;
    requests: number;
    frames: number;
    elapsedMs: number;
    heapUsedBytes?: number; // worker sample after cleanup, not a peak measurement
  };
  events: string[];
}
export interface RunOptions {
  completionProbes?: boolean;
  maxWork?: number;
  maxRounds?: number;
  maxFrames?: number;
  waitingPolicy?: WaitingPolicy;
  allowances?: Allowance[];
  groupChecks?: boolean;
}

const noop = () => {};
// Explicit hook shape: no Proxy trap on every runtime read/recompute. The type
// checker catches upstream additions rather than silently swallowing them.
const quietHooks: AttributionHooks = {
  interactionStart: noop,
  interactionEnd: noop,
  originStart: noop,
  originEnd: noop,
  flushEnd: noop,
  recomputeStart: noop,
  recomputeEnd: noop,
  derivedChanged: noop,
  write: noop,
  refreshed: noop,
  flightStart: noop,
  asyncStart: noop,
  asyncEnd: noop,
  effectRunStart: noop,
  effectRunEnd: noop,
  actionStepStart: noop,
  actionStepEnd: noop,
  holdStart: noop,
  holdEnd: noop,
  transitionSettled: noop,
  transitionMerged: noop,
  storeReplaced: noop,
  listChurn: noop,
  boundaryFallback: noop
};
async function afterAwait(fn: () => void) {
  await Promise.resolve();
  fn();
}
async function awaitAnswer(promise: Promise<number>, value: number) {
  await promise;
  return value;
}

class HarnessStop extends Error {
  constructor(
    readonly status: "invalid" | "limit",
    message: string
  ) {
    super(`${status.toUpperCase()}: ${message}`);
  }
}

export async function runScenario(input: Scenario, options: RunOptions = {}): Promise<RunResult> {
  const start = performance.now();
  const s = structuredClone(input);
  const invalid = validate(s);
  const result: RunResult = {
    status: invalid ? "invalid" : "pass",
    error: invalid,
    frames: [],
    scenario: s,
    requirements: [],
    work: [],
    coverage: [],
    events: [],
    metrics: { operations: 0, skipped: 0, requests: 0, frames: 0, elapsedMs: 0 }
  };
  if (invalid) return result;
  const model = new Model(s);
  const sources = model.sources;
  const canCheckProgress = progressScope(s, model);
  const groupExclusion = options.groupChecks === false ? "disabled" : groupScope(s, model);
  const groups = groupExclusion ? undefined : new Groups(model, s.readers);
  const outputTree = s.readers.some(r => r.render)
    ? new OutputTree(() => {
        throw new HarnessStop("limit", "output nodes");
      })
    : undefined;
  const outputRegions: Array<{ id: number; root: number; initialized: boolean; count: number }> =
    [];
  if (outputTree) result.attachment = { nodes: 0, privateWrites: 0, visibleWrites: 0, checks: 0 };
  const anchors = model.anchors;
  const readers = new Map<number, ReaderSpec>();
  for (const reader of s.readers) readers.set(reader.id, reader);
  const children = new Map<number, ReaderSpec[]>();
  for (const reader of s.readers)
    if (reader.parent !== undefined) {
      let siblings = children.get(reader.parent);
      if (!siblings) children.set(reader.parent, (siblings = []));
      siblings.push(reader);
    }
  const nested = children.size > 0;
  const history = new Map<number, Footprint>();
  for (const reader of s.readers)
    if (reader.boundary !== "none" || reader.parent !== undefined)
      history.set(reader.id, new Footprint(model, reader));
  const nodeIds = history.size ? s.nodes.map(node => node.id) : [];
  const mountIds: number[] = [];
  for (const reader of s.readers) if (reader.mounted !== undefined) mountIds.push(reader.id);
  const workByNode = new Map<number, Work[]>();
  for (const node of s.nodes) workByNode.set(node.id, []);
  const lastRequest = (node: number, inputs: number[]): Work | undefined => {
    const flights = workByNode.get(node)!;
    for (let i = flights.length - 1; i >= 0; i--)
      if (sameNumbers(flights[i].inputs, inputs)) return flights[i];
  };
  const host = new HostTasks(groups ? () => groups.beginTask() : undefined);
  const flightMasks = groups ? new WeakMap<object, number>() : undefined;
  const previousHooks = attrHooks;
  const work: Work[] = [];
  const byPromise = new WeakMap<object, Work>();
  const occurrences = new Map<string, number>();
  const outputs: Record<number, Output> = {};
  const disposers = new Map<number, () => void>();
  const liveGenerations = new Map<number, number>();
  const attachedGenerations = new Map<number, number>();
  const preparedOutputs = new Map<number, Output>();
  let readerGeneration = 0;
  const mountSetters = new Map<number, (value: boolean) => void>();
  const wantedMounts: Record<number, boolean> = {};
  for (const id of mountIds) wantedMounts[id] = readers.get(id)!.mounted!;
  const shownMounts = { ...wantedMounts };
  const callbacks = new Map<number, { steps: Leaf[]; via: string; done: boolean }>();
  const coverage = new Set<string>();
  if (canCheckProgress) coverage.add("ordinary-progress-scope");
  const writes = new Set<number>();
  const completed = new Set<number>();
  let writeId = 0;
  let sourceWrites = 0;
  let sourceWrite = 0;
  let showWrites = 0;
  let proposed = 0;
  const proposedInputs: Record<number, number> = {};
  for (const id of sources) proposedInputs[id] = 0;
  const shownInputs = { ...proposedInputs };
  const publicationTarget = () =>
    s.optimistic?.kind === "latest" && actionStarted && !actionEnded
      ? { ...proposedInputs, [-1]: 0 }
      : proposedInputs;
  let wantedShow = s.show;
  let shown = 0;
  let shownShow = s.show;
  let phase: "setup" | "run" | "cleanup" = "setup";
  let at = "setup";
  let disposeRoot = () => {};
  const setters = new Map<number, (value: number) => unknown>();
  const getters = new Map<number, () => number>();
  let setShow!: (value: boolean) => unknown;
  let retireError: string | undefined;
  let stopped: { error: unknown } | undefined;
  let executingAction: number | undefined;
  const scripts = new Map<
    number,
    {
      started: boolean;
      ended: boolean;
      segment: number;
      resume?: () => void;
      promise?: Promise<void>;
    }
  >();
  for (const spec of s.actions ?? [])
    scripts.set(spec.id, { started: false, ended: false, segment: 0 });
  let actionStarted = false;
  let actionEnded = false;
  let resumeAction: (() => void) | undefined;
  let actionPromise: Promise<void> | undefined;
  const actionGates: Array<{ step: number; state: "waiting" | "resolved" }> = [];
  const limit = options.maxWork ?? 120;
  const rounds = options.maxRounds ?? 40;
  const frameLimit = options.maxFrames ?? 600;
  const stop = (status: "invalid" | "limit", message: string) => {
    stopped ??= { error: new HarnessStop(status, message) };
  };
  const checkStopped = () => {
    if (stopped) throw stopped.error;
  };
  const drain = async () => {
    await host.drain();
    checkStopped();
  };

  const record = (event: string) => {
    if (phase !== "cleanup" && result.events.length < 500) result.events.push(`${at}: ${event}`);
  };
  const fail = (failure: Failure) => {
    if (
      phase === "run" &&
      !stopped &&
      (!result.failure ||
        (["W1", "O1", "O2", "P1", "G2"].includes(result.failure.rule) &&
          !["W1", "O1", "O2", "P1", "G2"].includes(failure.rule)))
    ) {
      result.failure = failure;
      result.status = "fail";
      result.requirements = requirements();
    }
  };
  const snapshot = (): Frame => {
    const saved: Record<number, Output> = {};
    for (const reader of s.readers) {
      const value = outputs[reader.id];
      saved[reader.id] = Array.isArray(value)
        ? value.slice()
        : typeof value === "object"
          ? { pending: value.pending }
          : value;
    }
    const frame: Frame = { at, input: shown, show: shownShow, outputs: saved };
    if (s.version === 2) {
      const inputs: Record<number, number> = {};
      for (const id of anchors) inputs[id] = shownInputs[id];
      frame.inputs = inputs;
    }
    if (mountIds.length) frame.mounts = { ...shownMounts };
    return frame;
  };
  function requirements(): Requirement[] {
    const values = model.evaluate(proposed, proposedInputs);
    const required: Requirement[] = [];
    for (const reader of s.readers) {
      if (reader.mounted !== undefined ? !wantedMounts[reader.id] : !disposers.has(reader.id))
        continue;
      const active = !reader.gated || wantedShow;
      let boundary: number | undefined;
      let ancestor: ReaderSpec | undefined = reader;
      while (ancestor) {
        if (outputs[ancestor.id] === "loading") {
          boundary = ancestor.id;
          break;
        }
        ancestor = ancestor.parent === undefined ? undefined : readers.get(ancestor.parent);
      }
      const fallback = boundary !== undefined;
      if (!active && !fallback) continue;
      const needed = model.select(reader.refs, values);
      for (let nodeIndex = 0; nodeIndex < s.nodes.length; nodeIndex++) {
        const node = s.nodes[nodeIndex];
        if (!needed[model.nodes[nodeIndex].slot] || node.delivery === "sync") continue;
        if (active) {
          const inputs = values.inputs(nodeIndex);
          const request = lastRequest(node.id, inputs);
          required.push({
            reader: reader.id,
            node: node.id,
            key: request?.key,
            inputs,
            gate: request?.state ?? "missing",
            fallback,
            basis: "desired",
            ...(boundary !== undefined && boundary !== reader.id ? { boundary } : {})
          });
        }
      }
      if (fallback) {
        const footprint = history.get(reader.id);
        if (footprint)
          for (const [w, witness] of footprint.retained)
            if (w.state === "waiting")
              required.push({
                reader: reader.id,
                node: w.node,
                key: w.key,
                inputs: w.inputs,
                gate: "waiting",
                fallback: true,
                basis: "fallback-retained",
                witness,
                ...(boundary !== reader.id ? { boundary } : {})
              });
      }
    }
    return required;
  }
  const checkReleased = () => {
    if (phase !== "run" || stopped) return;
    if (groups?.pending) {
      const groupFailure = groups.progress(snapshot(), requirements());
      if (groupFailure) fail(groupFailure);
    }
    if (!canCheckProgress) return;
    let unpublished = s.anchorShow !== false && shownShow !== wantedShow;
    for (const id of sources) if (shownInputs[id] !== proposedInputs[id]) unpublished = true;
    if (!unpublished) return;
    coverage.add("ordinary-progress-probe");
    const frame = snapshot();
    const failure = checkProgress(
      s,
      frame,
      proposedInputs,
      wantedShow,
      wantedMounts,
      requirements(),
      model
    );
    if (!failure) return;
    const outstanding: ProgressFinding["outstanding"] = [];
    for (const w of work)
      if (w.state === "waiting")
        outstanding.push({ key: w.key, observations: w.observations.map(o => ({ ...o })) });
    const narrowDisposal =
      sourceWrites === 1 &&
      s.version === 1 &&
      showWrites === 0 &&
      s.readers.every(r => !r.gated && r.boundary === "none");
    const allowance = progressAllowance(
      options.allowances ?? [],
      narrowDisposal,
      sourceWrite,
      outstanding
    );
    const findings = (result.progress ??= []);
    // Keep the first witness of each disposition; a later violation must not be
    // hidden because an earlier checkpoint matched the historical exception.
    if (!findings.some(f => f.allowance === allowance))
      findings.push({ failure, outstanding, allowance });
    coverage.add(allowance ? "progress-exception" : "progress-violation");
    if (!allowance) fail(failure);
  };
  const heldVerdict = () => {
    coverage.add("tracked-held-answer-verdict");
  };
  const checkpoint = () => {
    if (outputTree && phase !== "cleanup") {
      for (const region of outputRegions) {
        outputs[region.id] = outputTree.read(region.root);
        region.count = outputTree.count;
      }
      for (const region of outputRegions) {
        if (phase === "run") {
          result.attachment!.checks++;
          const failure = checkAttachment(
            region.id,
            region.count,
            region.initialized,
            disposers.has(region.id)
          );
          if (failure) fail({ ...failure, frame: snapshot() });
        }
        if (region.count === 1) region.initialized = true;
      }
      result.attachment!.nodes = outputTree.size;
      result.attachment!.privateWrites = outputTree.privateWrites;
      result.attachment!.visibleWrites = outputTree.visibleWrites;
      if (outputTree.privateWrites) coverage.add("detached-output-prepared");
    }
    if (phase !== "run" || stopped) return;
    const frame = snapshot();
    const groupingFailure = groups?.publication(frame);
    if (groupingFailure) fail(groupingFailure);
    result.metrics.frames++;
    if (result.frames.length >= frameLimit) {
      stop("limit", "publication frames");
      return;
    }
    result.frames.push(frame);
    if (history.size) {
      const desired = model.evaluate(proposed, proposedInputs);
      const published = model.evaluate(shown, shownInputs);
      let held = 0;
      for (let i = 0; i < sources.length; i++)
        if (desired.data[i] !== published.data[i]) held |= 1 << i;
      for (const [id, path] of history) {
        const reader = readers.get(id)!;
        const output = outputs[id];
        const active = disposers.has(id) && (!reader.gated || wantedShow);
        let content =
          Array.isArray(output) && path.anchored && output.length === reader.refs.length;
        if (content && Array.isArray(output))
          for (let i = 0; i < output.length; i++)
            if (output[i] !== published.get(reader.refs[i])) {
              content = false;
              break;
            }
        path.update(desired, published, content, active, lastRequest, nodeIds, at, sourceWrite);
        // With complete source witnesses, equality to the desired answer closes
        // the old content interval. Hidden/disposed regions close it as well.
        if (output === "hidden" || output === "absent" || (content && !(held & path.sources)))
          path.clear();
        if (outputs[id] === "loading" && path.retained.size)
          coverage.add("witnessed-fallback-work");
      }
    }
    const failure =
      checkFrame(s, frame, model) ?? checkPending(s, frame, proposedInputs, heldVerdict, model);
    if (failure) fail(failure);
    const req = requirements();
    let pendingSources = 0;
    for (const r of req) if (r.gate === "waiting") pendingSources |= model.sourceMask(r.node);
    if (pendingSources & (pendingSources - 1)) coverage.add("pending-work-uses-multiple-sources");
    // Scope the historical permission to unconditional readers without a
    // boundary. A conditional desired path need not be the published path.
    for (const r of req) {
      const reader = readers.get(r.reader)!;
      if (reader.gated || reader.boundary !== "none" || r.gate !== "waiting") continue;
      const w = lastRequest(r.node, r.inputs);
      if (w && !w.observations.some(o => o.reader === r.reader && o.write === sourceWrite))
        w.observations.push({ reader: r.reader, write: sourceWrite, at });
    }
    if (req.some(r => r.gate === "waiting")) coverage.add("observed-pending");
    let fallbacks = 0;
    let content = false;
    for (const reader of s.readers) {
      const value = outputs[reader.id];
      if (value === "loading") fallbacks++;
      else if (Array.isArray(value)) content = true;
    }
    if (fallbacks) coverage.add("published-fallback");
    if (fallbacks > 1) coverage.add("multiple-published-fallbacks");
    if (nested && fallbacks) {
      for (const reader of s.readers) {
        if (reader.parent === undefined) continue;
        if (outputs[reader.id] === "covered") coverage.add("nested-content-covered");
        if (outputs[reader.id] === "loading" && Array.isArray(outputs[reader.parent]))
          coverage.add("inner-fallback-beside-parent-content");
      }
    }
    if (fallbacks && content) coverage.add("fallback-beside-content");
    if (work.some(w => w.state === "waiting" && !req.some(r => r.key === w.key)))
      coverage.add("unrequired-flight");
    // A one-shot onSettled is scoped. Only use completion of ALL generated
    // writes, and verify publication rather than treating it as global idle.
    if (
      options.completionProbes !== false &&
      writes.size &&
      writes.size === completed.size &&
      (anchors.some(id => shownInputs[id] !== proposedInputs[id]) ||
        (s.anchorShow !== false && shownShow !== wantedShow) ||
        mountIds.some(id => shownMounts[id] !== wantedMounts[id]))
    )
      fail({
        rule: "S3",
        message: "All generated writes reported settled before their inputs published",
        frame,
        expected: {
          input: proposed,
          show: wantedShow,
          ...(mountIds.length ? { mounts: { ...wantedMounts } } : {}),
          ...(s.version === 2 ? { inputs: { ...proposedInputs } } : {})
        }
      });
  };
  const hooks: AttributionHooks = {
    ...quietHooks,
    flushEnd: checkpoint,
    asyncStart: node => {
      const mask = flightMasks?.get(node);
      if (mask !== undefined) groups!.landing(mask);
    },
    flightStart: (node, promise) => {
      const w = byPromise.get(promise);
      if (w) {
        w.registered = true;
        flightMasks?.set(node, model.sourceMask(w.node));
      }
    },
    transitionSettled: () => record("transition reported complete (before commit)")
  };

  const observe = (id: number, value: Output, generation: number, tree = false) => {
    if (phase === "cleanup") {
      if (!disposers.has(id))
        retireError ??= `Reader ${id} published after disposal during cleanup`;
      return;
    }
    if (!tree && liveGenerations.get(id) !== generation) {
      fail({ rule: "S5", message: "Disposed reader published", reader: id });
      return;
    }
    if (readers.get(id)!.mounted !== undefined) {
      preparedOutputs.set(generation, value);
      if (attachedGenerations.get(id) !== generation) {
        record(`prepared reader ${id}: ${JSON.stringify(value)}`);
        return;
      }
    }
    outputs[id] = value;
    record(`reader ${id}: ${JSON.stringify(value)}`);
    if (phase === "run" && Array.isArray(value) && model.tupleMasks.get(id)) {
      const reader = readers.get(id)!;
      const inputs: Record<number, number> = {};
      const mask = model.tupleMasks.get(id)!;
      for (let i = 0; i < reader.refs.length; i++) {
        const ref = reader.refs[i];
        if (ref < 0) inputs[ref] = value[i];
      }
      if (mask) {
        const values = model.evaluate(inputs[-1] ?? 0, inputs);
        // A tuple can certify a derivation only if it contains all of that
        // derivation's sources. Missing unrelated sources create no obligation.
        if (
          reader.refs.some((ref, i) => model.witnessed(ref, mask) && value[i] !== values.get(ref))
        )
          fail({
            rule: "S1",
            message: "Torn tuple delivered to an effect",
            reader: id,
            expected: reader.refs.map(ref => values.get(ref)),
            frame: snapshot()
          });
      }
    }
  };
  const skip = (message: string, strict = false) => {
    result.metrics.skipped++;
    if (strict && s.strict) throw new HarnessStop("invalid", message);
    record(`skip ${message}`);
  };
  function execute(step: Leaf) {
    checkStopped();
    result.metrics.operations++;
    if (result.metrics.operations > 800) throw new HarnessStop("limit", "operations");
    switch (step.op) {
      case "write":
      case "show": {
        const id = ++writeId;
        writes.add(id);
        if (step.op === "write") {
          sourceWrites++;
          sourceWrite = id;
          const source = step.source ?? -1;
          proposedInputs[source] = step.value;
          if (source === -1) proposed = step.value;
          groups?.write(source, step.value, snapshot(), executingAction);
          setters.get(source)!(step.value);
          coverage.add(`write-source-${source}`);
        } else {
          showWrites++;
          wantedShow = step.value;
          setShow(step.value);
        }
        record(
          `${step.op}${step.op === "write" && step.source !== undefined ? ` ${step.source}` : ""} ${step.value}`
        );
        if (options.completionProbes !== false)
          onSettled(() => {
            completed.add(id);
            record(`write ${id} settled`);
          });
        break;
      }
      case "resolve": {
        if (step.variantKeys)
          throw new HarnessStop("invalid", "Paired request choices require an equivalence replay");
        const flights = workByNode.get(step.node)!;
        let found: Work | undefined;
        const direction = step.which === "oldest" ? 1 : -1;
        for (
          let i = direction === 1 ? 0 : flights.length - 1;
          i >= 0 && i < flights.length;
          i += direction
        ) {
          const flight = flights[i];
          if (flight.state === "waiting" && (!step.key || flight.key === step.key)) {
            found = flight;
            break;
          }
        }
        if (!found) {
          skip(`missing request ${step.key ?? step.node}`, !!step.key);
          if (!step.key) Object.assign(step, { op: "noop" });
          break;
        }
        step.key = found.key;
        found.resolve();
        record(`resolve ${found.key}`);
        coverage.add(`resolve-${step.which}`);
        break;
      }
      case "dispose": {
        const dispose = disposers.get(step.reader);
        if (!dispose) {
          skip("already disposed reader");
          break;
        }
        disposers.delete(step.reader);
        liveGenerations.delete(step.reader);
        for (const w of work)
          if (w.state === "waiting")
            for (const o of w.observations) if (o.reader === step.reader) o.disposedAt = at;
        outputs[step.reader] = "absent";
        dispose();
        coverage.add("reader-disposal");
        break;
      }
      case "flush":
        coverage.add("explicit-flush");
        flush();
        groups?.separator();
        break;
      case "mount": {
        const id = ++writeId;
        writes.add(id);
        wantedMounts[step.reader] = step.value;
        mountSetters.get(step.reader)!(step.value);
        coverage.add(step.value ? "reader-mount-request" : "reader-unmount-request");
        record(`mount ${step.reader} ${step.value}`);
        if (options.completionProbes !== false)
          onSettled(() => {
            completed.add(id);
            record(`write ${id} settled`);
          });
        break;
      }
      case "start-action": {
        if (s.actions) {
          const spec = s.actions.find(a => a.id === step.action)!;
          const state = scripts.get(spec.id)!;
          if (state.started) {
            skip("action already started");
            break;
          }
          state.started = true;
          groups?.startAction(spec.id, snapshot());
          const run = action(function* () {
            for (let i = 0; i < spec.segments.length; i++) {
              if (phase === "cleanup") return;
              if (i > 0) groups?.resumeAction(spec.id);
              state.segment = i;
              executingAction = spec.id;
              try {
                for (const write of spec.segments[i])
                  execute({ op: "write", source: write.source, value: write.value });
              } finally {
                executingAction = undefined;
              }
              if (i + 1 < spec.segments.length)
                yield new Promise<void>(resolve => {
                  state.resume = resolve;
                });
            }
            state.ended = true;
            groups?.finishAction(spec.id);
            record(`action ${spec.id} body completed`);
          });
          state.promise = run();
          void state.promise.catch(error => {
            stopped ??= { error };
          });
          record(`action ${spec.id} started`);
          break;
        }
        if (actionStarted) {
          skip("action already started");
          break;
        }
        actionStarted = true;
        coverage.add("action-started");
        const run = action(function* () {
          for (const value of s.optimistic!.proposals) {
            if (phase === "cleanup") return;
            if (s.optimistic!.kind === "latest") {
              execute({ op: "write", source: -1, value });
              proposedInputs[-2] = value;
            } else execute({ op: "write", source: -2, value });
            const gate = { step: actionGates.length, state: "waiting" as "waiting" | "resolved" };
            actionGates.push(gate);
            yield new Promise<void>(resolve => {
              resumeAction = () => {
                gate.state = "resolved";
                resolve();
              };
            });
          }
          if (phase === "cleanup") return;
          execute({ op: "write", source: -1, value: s.optimistic!.authoritative });
          proposedInputs[-2] = s.optimistic!.authoritative;
          actionEnded = true;
          coverage.add("action-body-completed");
        });
        actionPromise = run();
        // Own failures immediately; don't let an invalid experiment escape as
        // an unhandled rejection, and don't call a rejected action successful.
        void actionPromise.catch(error => {
          stopped ??= { error };
        });
        break;
      }
      case "resume-action": {
        if (s.actions) {
          const state = scripts.get(step.action!)!;
          const resume = state.resume;
          if (!resume) {
            skip("action is not waiting");
            break;
          }
          state.resume = undefined;
          record(`resume action ${step.action}`);
          resume();
          break;
        }
        if (!resumeAction) {
          skip("action is not waiting");
          break;
        }
        const resume = resumeAction;
        resumeAction = undefined;
        record("resume action gate");
        resume();
        break;
      }
      case "read": {
        const read: NonNullable<RunResult["reads"]>[number] = {
          at,
          ref: step.ref,
          mode: step.mode
        };
        try {
          const getter = getters.get(step.ref)!;
          if (step.mode === "pending") read.verdict = isPending(getter);
          else read.value = step.mode === "latest" ? latest(getter) : getter();
        } catch (error) {
          if (!(error instanceof NotReadyError)) throw error;
          read.pending = true;
          if (step.mode === "pending")
            fail({
              rule: "R3",
              message: "Context-free isPending propagated NotReadyError",
              frame: snapshot()
            });
        }
        (result.reads ??= []).push(read);
        coverage.add(`imperative-${step.mode}-read`);
        // Ordinary context-free reads describe published state. latest has its
        // own unresolved outside-read contract, including forwarding getters:
        // retain samples for paired laziness checks without choosing a slot.
        if (step.mode === "plain" && model.readsLatest(step.ref))
          coverage.add("imperative-latest-contract-provisional");
        if (step.mode === "plain" && !model.readsLatest(step.ref)) {
          let expected: number | undefined = anchors.includes(step.ref)
            ? shownInputs[step.ref]
            : undefined;
          if (expected === undefined)
            for (const reader of s.readers) {
              const value = outputs[reader.id];
              const index = reader.refs.indexOf(step.ref);
              if (Array.isArray(value) && index !== -1) {
                expected = value[index];
                break;
              }
            }
          if (expected === undefined) coverage.add("imperative-read-without-published-witness");
          else if (!read.pending && read.value !== expected)
            fail({
              rule: "R1",
              message: "Imperative ordinary read disagrees with its published view",
              frame: snapshot(),
              expected: { ref: step.ref, value: expected, actual: read.value }
            });
          else if (read.pending)
            fail({
              rule: "R1",
              message: "Published readable value suspended in an imperative read",
              frame: snapshot(),
              expected: { ref: step.ref, value: expected }
            });
        }
        break;
      }
      case "click": {
        const output = outputs[step.reader];
        if (!output || typeof output !== "object" || Array.isArray(output) || output.pending) {
          skip("guarded control is not ready");
          break;
        }
        const reader = readers.get(step.reader)!;
        const click: NonNullable<RunResult["clicks"]>[number] = { at, reader: step.reader };
        try {
          click.values = reader.refs.map(id => getters.get(id)!());
        } catch (error) {
          if (!(error instanceof NotReadyError)) throw error;
          click.pending = true;
          fail({
            rule: "R2",
            message: "A published ready control suspended when clicked",
            reader: reader.id,
            frame: snapshot()
          });
        }
        (result.clicks ??= []).push(click);
        coverage.add("ready-control-click");
        if (click.values) {
          const expected = model.evaluate(shown, shownInputs);
          if (
            reader.refs.some(
              (ref, i) => model.witnessed(ref) && click.values![i] !== expected.get(ref)
            )
          )
            fail({
              rule: "R2",
              message: "A ready control read data inconsistent with published inputs",
              reader: reader.id,
              frame: snapshot(),
              expected: reader.refs.map(id => expected.get(id))
            });
        }
        break;
      }
      case "noop":
        break;
    }
  }
  function block(steps: Step[]) {
    for (const step of steps) {
      if (step.op === "queue") {
        const cb = { steps: queuedSteps(step), via: step.via, done: false };
        callbacks.set(step.id, cb);
        const run = () => {
          if (!cb.done && !stopped) {
            cb.done = true;
            groups?.closeBatch();
            // Report owned callback failures at the next host barrier. Letting
            // these escape would lose the ledger and crash the worker instead.
            try {
              for (const step of cb.steps) execute(step);
            } catch (error) {
              stopped ??= { error };
            }
          }
        };
        coverage.add(step.via);
        if (step.via === "microtask") queueMicrotask(run);
        else if (step.via === "promise") Promise.resolve().then(run);
        else if (step.via === "await") void afterAwait(run);
      } else if (step.op === "cancel") {
        const cb = callbacks.get(step.id);
        if (cb?.via === "task" && !cb.done) {
          cb.done = true;
          coverage.add("cancel-task");
        } else skip("callback unavailable for cancellation");
      } else execute(step);
    }
  }
  async function settle(requiredOnly: boolean, setup = false) {
    for (let round = 0; ; round++) {
      // Fulfilled promises can schedule another memo even when no gate is
      // currently waiting. Reach a real task boundary before declaring quiet.
      await drain();
      if (setup) {
        flush();
        checkStopped();
      }
      checkReleased();
      const req = requiredOnly ? requirements() : undefined;
      const selected: Work[] = [];
      for (const w of work)
        if (w.state === "waiting" && (!req || req.some(r => r.key === w.key))) selected.push(w);
      if (!selected.length) return;
      if (round >= rounds) throw new HarnessStop("limit", "settling rounds");
      await host.run(() => {
        for (const w of selected) {
          record(`required ${w.key}`);
          w.resolve();
        }
      });
      await drain();
      if (setup) {
        flush();
        checkStopped();
      }
    }
  }
  try {
    setAttributionHooks(hooks);
    createRoot(dispose => {
      disposeRoot = dispose;
      for (const id of sources) {
        if (s.optimistic && id === -2) continue;
        const [source, write] = createSignal(0);
        getters.set(id, source);
        setters.set(id, write);
      }
      const source = getters.get(-1)!;
      if (s.optimistic) {
        const latestSource = s.optimistic.viaMemo ? createMemo(() => source()) : source;
        if (s.optimistic.kind === "latest")
          getters.set(-2, () => {
            if (phase === "run") {
              coverage.add("latest-channel-read");
              coverage.add(s.optimistic!.viaMemo ? "latest-of-memo" : "latest-of-signal");
            }
            return latest(latestSource);
          });
        else {
          const [view, write] = createOptimistic(() => source());
          getters.set(-2, view);
          setters.set(-2, write);
        }
      }
      const [visible, show] = createSignal(s.show);
      setShow = show;
      for (const node of s.nodes) {
        getters.set(
          node.id,
          createMemo(() => {
            const inputs = capture(node, id => getters.get(id)!());
            const value = answer(node, inputs);
            if (node.branch && phase === "run")
              coverage.add(inputs[0] ? "branch-true" : "branch-false");
            if (node.delivery === "sync") return value;
            if (work.length >= limit) {
              // The case is now inconclusive. Avoid throwing a harness budget
              // error through Solid's user computation/error propagation path.
              // No more observations are checked; the worker will be retired.
              stop("limit", "async work");
              return value;
            }
            const question = `${node.id}:${JSON.stringify(inputs)}`;
            const ordinal = (occurrences.get(question) ?? 0) + 1;
            occurrences.set(question, ordinal);
            let resolve!: (value: number) => void;
            const gate = new Promise<number>(r => {
              resolve = r;
            });
            const w: Work = {
              key: `${question}#${ordinal}`,
              node: node.id,
              inputs,
              value,
              state: "waiting",
              registered: false,
              observations: [],
              resolve() {
                if (w.state === "waiting") {
                  w.state = "resolved";
                  resolve(value);
                }
              }
            };
            work.push(w);
            workByNode.get(node.id)!.push(w);
            const promise = node.delivery === "await" ? awaitAnswer(gate, value) : gate;
            byPromise.set(promise, w);
            if (node.delivery === "promise") w.resolve();
            record(`start ${w.key}`);
            return promise;
          })
        );
      }
      for (const id of anchors)
        createRenderEffect(getters.get(id)!, value => {
          shownInputs[id] = value;
          if (id === -1) shown = value;
        });
      if (s.anchorShow !== false)
        createRenderEffect(visible, value => {
          shownShow = value;
        });
      if (s.anchors !== undefined && s.anchors.length < sources.length)
        coverage.add("partial-source-observation");
      if (s.anchorShow === false) coverage.add("no-visibility-anchor");
      const treeHost: TreeHost | undefined = nested
        ? {
            read(reader) {
              const path = history.get(reader.id);
              if (path) path.attempted = 0;
              const values: number[] = [];
              for (const ref of reader.refs) {
                if (path) path.attempted++;
                values.push(getters.get(ref)!());
              }
              return values;
            },
            reset: source,
            born(reader, dispose) {
              const generation = ++readerGeneration;
              disposers.set(reader.id, dispose);
              liveGenerations.set(reader.id, generation);
              if (outputs[reader.id] === undefined)
                outputs[reader.id] = reader.parent === undefined ? "hidden" : "covered";
              return generation;
            },
            gone(reader, generation) {
              if (liveGenerations.get(reader.id) === generation) {
                liveGenerations.delete(reader.id);
                disposers.delete(reader.id);
              }
            },
            publish(reader, output, generation) {
              // Tree scopes check actual callbacks against their cleanup flags;
              // attaching cached content is not itself a disposed effect callback.
              observe(reader.id, output, generation, true);
            },
            covered(reader) {
              outputs[reader.id] = "covered";
            },
            stale(reader) {
              fail({ rule: "S5", message: "Disposed reader published", reader: reader.id });
            }
          }
        : undefined;
      for (const reader of s.readers) {
        if (reader.render) {
          const root = outputTree!.create(true);
          outputRegions.push({ id: reader.id, root, initialized: false, count: 0 });
          outputs[reader.id] = "absent";
          createRoot(dispose => {
            disposers.set(reader.id, dispose);
            mountOutput(outputTree!, root, reader.render!, getters.get(reader.render!.on)!, () => {
              const values: number[] = [];
              for (const ref of reader.refs) values.push(getters.get(ref)!());
              return values;
            });
          });
          coverage.add(`output-${reader.render.target}`);
          continue;
        }
        if (nested) {
          if (reader.parent === undefined) mountTree(reader, children, treeHost!);
          continue;
        }
        outputs[reader.id] = "absent";
        const mount = () =>
          createRoot(dispose => {
            const generation = ++readerGeneration;
            disposers.set(reader.id, dispose);
            liveGenerations.set(reader.id, generation);
            // A marker distinguishes not-yet-published from explicitly disposed.
            if (reader.mounted === undefined) outputs[reader.id] = "hidden";
            const footprint = history.get(reader.id);
            const probe = () => {
              if (footprint) footprint.attempted = 0;
              for (const ref of reader.refs) {
                if (footprint) footprint.attempted++;
                getters.get(ref)!();
              }
            };
            const readData = (): number[] => {
              if (footprint) footprint.attempted = 0;
              const values: number[] = [];
              for (const ref of reader.refs) {
                if (footprint) footprint.attempted++;
                values.push(getters.get(ref)!());
              }
              return values;
            };
            let verdict: (() => number) | undefined;
            let ready = 0;
            if (reader.pendingDepth) {
              verdict = createMemo(() => (isPending(probe) ? 1 : 0));
              for (let depth = 1; depth < reader.pendingDepth; depth++) {
                const previous = verdict;
                verdict = createMemo(() => previous!() * 3 + 2);
                ready = ready * 3 + 2;
              }
              coverage.add("derived-pending-verdict");
            }
            const read = (): Output =>
              reader.gated && !visible()
                ? "hidden"
                : reader.pending
                  ? { pending: verdict ? verdict() !== ready : isPending(probe) }
                  : readData();
            const view =
              reader.boundary === "none"
                ? read
                : createLoadingBoundary(
                    read,
                    () => "loading" as const,
                    reader.boundary === "reset" ? { on: source } : undefined
                  );
            createRenderEffect(view, value => observe(reader.id, value, generation));
            return {
              generation,
              dispose: () => {
                if (liveGenerations.get(reader.id) === generation) {
                  liveGenerations.delete(reader.id);
                  disposers.delete(reader.id);
                }
                dispose();
                preparedOutputs.delete(generation);
              }
            };
          });
        if (reader.mounted === undefined) mount();
        else {
          const [mounted, setMounted] = createSignal(reader.mounted);
          mountSetters.set(reader.id, setMounted);
          // This anchor explicitly represents a displayed mount control, just
          // like the source and visibility anchors elsewhere in this grammar.
          createRenderEffect(mounted, value => {
            shownMounts[reader.id] = value;
          });
          createRenderEffect(
            () => {
              const value = mounted();
              if (value) {
                const { generation, dispose } = mount();
                onCleanup(dispose);
                if (phase === "run") coverage.add("owned-reader-created");
                return generation;
              }
              return undefined;
            },
            generation => {
              // Child effects may prepare detached content before this parent
              // publishes. Only attachment makes that content observable here.
              if (generation === undefined) {
                attachedGenerations.delete(reader.id);
                outputs[reader.id] = "absent";
              } else {
                attachedGenerations.set(reader.id, generation);
                const value = preparedOutputs.get(generation);
                if (value !== undefined) observe(reader.id, value, generation);
                else outputs[reader.id] = "absent";
              }
            }
          );
        }
      }
    });
    flush();
    checkStopped();
    await settle(false, true);
    await drain();
    flush();
    if (s.warmLatest?.length) {
      const before = work.length;
      result.warmup = { requests: 0, pending: false };
      await host.run(() => {
        for (const id of s.warmLatest!)
          try {
            latest(getters.get(id)!);
          } catch (error) {
            if (!(error instanceof NotReadyError)) throw error;
            result.warmup!.pending = true;
          }
      });
      await drain();
      result.warmup.requests = work.length - before;
    } else {
      // Match the early-warm variant's scheduling boundary exactly.
      await host.run(() => {});
      await drain();
    }
    phase = "run";
    at = "initial";
    checkpoint();
    for (let i = 0; i < s.turns.length; i++) {
      at = `turn ${i}`;
      const turn = s.turns[i];
      await host.run(() => {
        if ("steps" in turn) block(turn.steps);
        else {
          const cb = callbacks.get(turn.task);
          if (!cb || cb.done || cb.via !== "task") skip("task unavailable");
          else {
            cb.done = true;
            for (const step of cb.steps) execute(step);
          }
        }
      });
      await drain();
      checkpoint();
      checkReleased();
      if (s.optimistic && actionStarted && !actionEnded) {
        const req = requirements();
        if (req.every(r => r.gate === "resolved")) {
          coverage.add("optimistic-ready-with-parent-open");
          const target = publicationTarget();
          const failure = checkOptimistic(s, snapshot(), target, model);
          if (failure) fail(failure);
        }
      }
    }
    // Undelivered task callbacks are future external inputs, not orphaned memos.
    at = "remaining tasks";
    for (const cb of callbacks.values())
      if (!cb.done && cb.via === "task") {
        await host.run(() => {
          cb.done = true;
          for (const step of cb.steps) execute(step);
        });
        await drain();
        checkReleased();
      }
    // Action gates are future external completions, not memo requests. Finish
    // the finite script before entering the no-new-input completion suffix.
    at = "remaining action steps";
    for (let i = 0; resumeAction && !s.optimistic?.hold; i++) {
      if (i >= 4) throw new HarnessStop("limit", "action steps");
      await host.run(() => execute({ op: "resume-action" }));
      await drain();
    }
    for (const [id, state] of scripts) {
      while (state.resume) {
        await host.run(() => execute({ op: "resume-action", action: id }));
        await drain();
        checkpoint();
        checkReleased();
      }
      if (state.promise) await state.promise;
    }
    if (actionPromise && !s.optimistic?.hold) await actionPromise;
    if (s.optimistic?.hold && actionStarted && !actionEnded)
      coverage.add("completion-with-parent-held");
    at = "required completion";
    await settle(true);
    await drain();
    checkpoint();
    checkReleased();
    const before = snapshot();
    const finalCheck = () =>
      checkFinal(
        s,
        snapshot(),
        publicationTarget()[-1],
        wantedShow,
        s.version === 2 ? publicationTarget() : undefined,
        wantedMounts,
        model
      );
    const earlyFailure = finalCheck();
    const policy = options.waitingPolicy ?? "review";
    const narrowScope =
      sourceWrites === 1 &&
      s.version === 1 &&
      showWrites === 0 &&
      s.readers.every(r => !r.gated && r.boundary === "none");
    const pending = work.filter(w => w.state === "waiting");
    if (s.optimistic && actionEnded && earlyFailure && pending.length)
      fail({
        ...earlyFailure,
        rule: "O2",
        message:
          "Authoritative publication still needs work outside its current requirements after the action body completes"
      });
    const retained = narrowScope
      ? pending.flatMap(w => {
          const observations = retainedObservations(w.observations, sourceWrite);
          return observations.length ? [{ key: w.key, observations }] : [];
        })
      : [];
    const retainedKeys = new Set(retained.map(w => w.key));
    if (earlyFailure && pending.length) {
      result.waiting = {
        rule: "W1",
        message: "Publication waits beyond currently required work",
        policy,
        disposition: "open",
        scope: narrowScope ? "single-write-disposal" : "other",
        before,
        afterRetained: before,
        after: before,
        pending: pending.map(w => w.key),
        retained,
        releases: [],
        recovered: false
      };
      if (policy === "required-only") {
        result.waiting.disposition = "violation";
        fail({ ...earlyFailure, rule: "W1" });
      }
    }
    // Once a correct final view has been reached, no residual completion may
    // change it. Arm this even if reaching it required a retained request.
    let stable = earlyFailure
      ? undefined
      : JSON.stringify([shownInputs, shownShow, shownMounts, outputs]);
    const release = async (w: Work, retained: boolean) => {
      coverage.add("residual-completion");
      record(`residual ${w.key}`);
      await host.run(() => w.resolve());
      await drain();
      checkpoint();
      checkReleased();
      result.waiting?.releases.push({ key: w.key, retained, frame: snapshot() });
      const view = JSON.stringify([shownInputs, shownShow, shownMounts, outputs]);
      if (stable !== undefined && stable !== view)
        fail({
          rule: "S4",
          message: "Residual work changed a completed view without new input",
          frame: snapshot()
        });
      if (stable === undefined && !finalCheck()) stable = view;
    };
    // Resolve only the witnessed requests first. New descendants and other
    // residual flights must not silently inherit their permission.
    at = "retained completion";
    let residualRounds = 0;
    for (const w of pending) {
      if (!retainedKeys.has(w.key)) continue;
      if (residualRounds++ >= rounds) throw new HarnessStop("limit", "residual rounds");
      await release(w, true);
    }
    if (result.waiting) {
      result.waiting.afterRetained = snapshot();
      // The accepted disposal exception is a sufficient permission, not a
      // claim that every other kind of residual waiting violates a contract.
      const retainedFailure = finalCheck();
      if (
        policy === "review" &&
        options.allowances?.includes("legacy-disposal-wait") &&
        narrowScope &&
        retained.length &&
        !retainedFailure
      )
        result.waiting.disposition = "allowed";
      if (policy === "retain-disposed") {
        const failure = retainedFailure;
        result.waiting.disposition = !narrowScope
          ? "out-of-scope"
          : failure
            ? "violation"
            : "allowed";
        if (narrowScope && failure) fail({ ...failure, rule: "W1" });
      }
    }
    at = "residual completion";
    for (;;) {
      const residual = work.findLast(w => w.state === "waiting");
      if (!residual) break;
      if (residualRounds++ >= rounds) throw new HarnessStop("limit", "residual rounds");
      await release(residual, false);
    }
    at = "final completion";
    await drain();
    checkpoint();
    checkStopped();
    const finalFailure = finalCheck();
    if (finalFailure) fail(finalFailure);
    if (result.waiting) {
      result.waiting.after = snapshot();
      result.waiting.recovered = !finalFailure;
      if (!result.failure && result.waiting.disposition !== "allowed") result.status = "policy";
    }
    if (!result.failure) result.requirements = requirements();
  } catch (error) {
    result.error = error instanceof Error ? error.stack : String(error);
    result.status = error instanceof HarnessStop ? error.status : "error";
  } finally {
    if (s.actions) result.actionScripts = [];
    for (const [id, state] of scripts)
      result.actionScripts!.push({
        id,
        started: state.started,
        ended: state.ended,
        segment: state.segment,
        waiting: !!state.resume
      });
    result.groups = {
      scope: groupExclusion,
      events: groups?.events ?? [],
      checks: groups?.checks ?? 0,
      held: groups?.held ?? 0,
      possibleJoins: groups?.possibleJoins ?? 0,
      batchingHeld: groups?.batchingHeld ?? 0
    };
    if (s.optimistic)
      result.action = {
        started: actionStarted,
        bodyCompleted: actionEnded,
        gates: structuredClone(actionGates)
      };
    // Preserve the stopped case, not the physical gate releases used for teardown.
    result.work = work.map(({ resolve, ...record }) => record);
    phase = "cleanup";
    try {
      for (const [id, dispose] of disposers) {
        disposers.delete(id);
        liveGenerations.delete(id);
        outputs[id] = "absent";
        dispose();
      }
      disposeRoot();
      for (const cb of callbacks.values()) cb.done = true;
      // Roots are disposed: release remaining gates without reusing the case's
      // exhausted completion budget or throwing its already-recorded stop again.
      await host.run(() => {
        for (const w of work) w.resolve();
      });
      await host.drain();
      // Finish a paused finite action after a harness stop. Its remaining
      // generator writes are guarded by checkStopped and reject harmlessly.
      for (const state of scripts.values()) {
        state.resume?.();
        if (state.promise) await state.promise.catch(() => {});
      }
      if (resumeAction) {
        resumeAction();
        await host.drain();
      }
      flush();
    } catch (error) {
      retireError = String(error);
    }
    setAttributionHooks(previousHooks);
    host.close();
    if (retireError) {
      result.status = "error";
      result.cleanupError = retireError;
      result.error ??= `Cleanup failed: ${retireError}`;
    }
    if (history.size) {
      result.footprints = [];
      for (const [reader, path] of history) {
        const requested: number[] = [];
        const published: number[] = [];
        for (const [ref, slot] of model.slots) {
          if (path.requested[slot]) requested.push(ref);
          if (path.publishedKnown && path.published[slot]) published.push(ref);
        }
        result.footprints.push({
          reader,
          requested,
          ...(path.publishedKnown ? { published } : {})
        });
      }
    }
    result.coverage = [...coverage].sort();
    result.metrics.requests = work.length;
    result.metrics.elapsedMs = performance.now() - start;
    result.scenario.strict = true;
    result.scenario = canonicalize(result.scenario);
  }
  return result;
}
