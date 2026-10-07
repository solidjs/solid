/**
 * The `mount-under-hold` cohort: boundary and lane mounts made while a hold is
 * live, checked only against ruled behavior (rules MH1–MH8 in rules.ts).
 *
 * The general scenario language mounts readers through a harness-owned flag
 * and cannot express a `Show` conditioned on a held value, a `Loading` mounted
 * by a flip, `on` re-arming, bindings under a lane's mount, or a verdict-lane
 * mount. This module builds those shapes directly from a small parametric case
 * (`MountCase`), the way compiled JSX builds them (`Show` as a mounting render
 * effect, or as a condition memo + children memo + insert effect; `Loading` as
 * an untracked `createLoadingBoundary`), and records what the screen shows at
 * fixed checkpoints:
 *
 *   S0 setup settled · S1 hold established · S2 the mount (or the hold that
 *   mounts) settled · S3 the hold released and settled · S4 every remaining
 *   first load resolved and settled (the final view).
 *
 * Shapes the rulings do not decide are still generated, but only the
 * invariants (MH5 no tearing, MH7 convergence) apply to them; `unruled()`
 * names each one.
 *
 * This module is runtime-free (the CLI bundles it); execution is in
 * mount-hold.ts, which only the worker imports.
 */
import type { RunResult } from "./runner.js";
import type { Scenario } from "./scenario.js";

export type MountFamily =
  /** A new `Loading` (never shown content) mounted while the hold is live. */
  | "fresh"
  /** A revealed `<Loading on={open()}>` whose tree mounts content on `open`:
   * the mounting flush re-arms it. */
  | "rearm-mount"
  /** A revealed `<Loading on={key()}>` whose committed content reads the held
   * value; `key` changes while the hold is live. */
  | "rearm-committed"
  /** A revealed `Loading` (not re-armed) whose tree mounts content on `open`. */
  | "revealed"
  /** A `Show` mounting content with no boundary. */
  | "none"
  /** A revealed `Loading` under an outer one still on its fallback (a
   * sibling's first load created before the hold). */
  | "revealed-under-pending"
  /** A revealed `Loading` under an outer `<Loading on={open()}>` the flip
   * re-arms. */
  | "revealed-under-rearmed"
  /** `<Show when={x() > 0}>` with `x` held: the mount is part of the hold. */
  | "held-cond"
  /** `<Show when={latest(x) > 0}>`: a verdict-lane mount of a new `Loading`. */
  | "verdict"
  /** `createOptimistic` + `Show`: the lane's mount and its binding (#3835). */
  | "lane";

export interface MountCase {
  kind: "mount-under-hold";
  version: 1;
  family: MountFamily;
  /** `action`: an action's staged write (a landed, held value). `flight`: a
   * mainline write whose observed async answer is in flight. */
  hold: "action" | "flight";
  /** `flip`: a signal flips in a flush while the hold is live. `root`: a
   * mainline `createRoot` mount outside a flush. `same-tick`: the flip is
   * written in the same synchronous block as the hold's write. `hold`: the
   * hold itself mounts (held-cond, verdict, lane). */
  trigger: "flip" | "root" | "same-tick" | "hold";
  /** `effect`: Show as a mounting render effect with child effects. `memo`:
   * condition memo + children memo + one insert effect. For families with an
   * existing boundary, `memo` puts the condition in the boundary's tree. */
  show: "effect" | "memo";
  /** How the content reads the held value: a memo, directly, a binding (a
   * render effect under the element; the tree never reads it), or through a
   * nested new `Loading` (fresh, held-cond and verdict only). */
  content: "memo" | "direct" | "bound" | "nested";
  /** The content also has a first load of its own (an async memo over the
   * held value, resolved at S4). */
  ownLoad: boolean;
  /** The new boundary carries an `on` key that never changes (fresh), or the
   * revealed boundary does (revealed). */
  keyed: boolean;
  /** held-cond: whether a new `Loading` wraps the content. */
  boundary: boolean;
  /** The held value (the committed one is 0). */
  value: number;
  /** The screen anchor for the held source is created after the mount site. */
  anchorLast: boolean;
  /** Whether the screen anchor exists: a committed render effect outside every
   * boundary that reads the held source (a committed outside read). Absent in
   * revision-20 artifacts, where it always existed. Without it the screen's
   * value is an untracked top-level read (action holds) or unobserved. */
  anchor?: boolean;
  /** Nested content only: the new outer boundary's tree also reads the held
   * source (an uncommitted outside read of the inner boundary). */
  outerRead?: boolean;
  lane?: {
    /** The view is created inside a memo the lane creates. */
    wrap: boolean;
    /** The binding reads the action's held source, the lane's guess, or a
     * memo of the held source created by the view. */
    reads: "held" | "guess" | "derived";
  };
}

export const isMountCase = (s: unknown): s is MountCase =>
  (s as MountCase | undefined)?.kind === "mount-under-hold";

/** Checkpoint labels in order. */
const checkpoints = ["S0", "S1", "S2", "S3", "S4"] as const;
export type Checkpoint = (typeof checkpoints)[number];

export interface MountSnapshot {
  at: Checkpoint;
  /** The screen's value of the held source (a render effect reading it). */
  x: number | undefined;
  /** What the mount site shows, normalized (see `seen`). */
  seen: string;
  /** The action (lane family) is still running. */
  running: boolean;
}

interface Check {
  at: Checkpoint;
  rule: string;
  message: string;
  seen?: string;
  notSeen?: string;
  x?: number;
}

/** The ruled timeline for a case; shapes outside the rulings get none. */
export function expectations(c: MountCase): Check[] {
  const V = c.value;
  const nested = c.content === "nested";
  const fb = nested ? "[fallback]" : "fallback";
  const done = nested ? `[content ${V}]` : `content ${V}`;
  const out: Check[] = [];
  const fallbackNow = (at: Checkpoint) =>
    out.push({
      at,
      rule: "MH1",
      message:
        "a boundary that has not shown content (or that `on` re-armed) did not show its fallback while its content waited",
      seen: fb
    });
  const revealAtCommit = () =>
    out.push({
      at: "S3",
      rule: "MH2",
      message: "content that waited for a hold did not reveal at the hold's commit",
      seen: done
    });
  const holdDoesNotWait = () =>
    out.push({
      at: "S3",
      rule: "MH3",
      message: "the hold waited for never-committed work a boundary owns",
      x: V
    });
  const hiddenWithHold = () =>
    out.push({
      at: "S2",
      rule: "MH4",
      message:
        "a mount with no catcher (or one that is part of the hold) appeared before the hold's commit",
      seen: "closed"
    });
  if (unruled(c)) return out;
  // A render effect reading the held source directly is a stale reader (A15
  // reveal carve-out): it shows the committed value now and waits for nothing.
  // Only while something else holds the source: a flight with no anchor has
  // the content as its only reader, pending under the boundary (A33).
  const staleReader = (family: MountFamily) =>
    c.content === "direct" &&
    !c.ownLoad &&
    (anchored(c) || c.hold === "action") &&
    (family === "none" ||
      (c.show === "effect" && (family === "revealed" || family === "rearm-mount")));
  switch (c.family) {
    // A29's boundary exemption: a boundary that has not shown content shows its
    // fallback now, beside a committed outside read of the held source or not;
    // a root mount too. A `latest()` condition mounts mainline (rev 22).
    case "fresh":
    case "verdict":
    // The re-arm's swap lands with the frame of the flip that caused it
    // (#3575). The flip never writes the held source, so the anchor does not
    // hold that frame: fallback now if anything waits under the boundary, a
    // no-op if nothing does.
    case "rearm-mount":
    case "rearm-committed":
      if (staleReader(c.family))
        out.push({
          at: "S2",
          rule: "MH8",
          message: "an `on` re-arm with nothing pending under the boundary showed its fallback",
          notSeen: "fallback"
        });
      else if (c.outerRead)
        out.push({
          at: "S2",
          rule: "MH1",
          message:
            "an uncommitted read outside the inner boundary: its own catcher (the outer boundary) did not show its fallback",
          seen: "outer fallback"
        });
      else fallbackNow("S2");
      if (c.ownLoad) {
        fallbackNow("S3");
        holdDoesNotWait();
      } else revealAtCommit();
      break;
    case "held-cond":
      hiddenWithHold();
      if (!c.ownLoad) revealAtCommit();
      else if (c.boundary) {
        // Appears at the hold's commit; its own first load is its own.
        fallbackNow("S3");
        holdDoesNotWait();
      }
      break;
    case "revealed":
    case "none":
      if (!staleReader(c.family)) hiddenWithHold();
      revealAtCommit();
      break;
    case "revealed-under-pending":
      // The outer boundary's pending sibling was created before the hold
      // (§15.2: a loading source is not held).
      holdDoesNotWait();
      break;
    case "lane": {
      const guess = c.lane!.reads === "guess";
      out.push({
        at: "S2",
        rule: "MH6",
        message:
          "an optimistic mount and its binding did not land together in the lane's world (the screen plus its own guesses)",
        seen: `content ${guess ? V : 0}`
      });
      out.push({
        at: "S3",
        rule: "MH6",
        message: "an optimistic mount's binding did not re-derive at the action's landing",
        seen: `content ${V}`
      });
      break;
    }
  }
  return out;
}

/** Revision-20 artifacts carry no `anchor`: the anchor always existed. */
export const anchored = (c: MountCase) => c.anchor !== false;

/** Shapes the rulings do not decide: invariants only. */
export function unruled(c: MountCase): string | undefined {
  if (c.trigger === "same-tick")
    return "a flip written in the same tick as the hold's first write: whether the mount is part of the hold (A34 (1) joins a tick's writes only through a write to a held node)";
  if (c.family === "revealed-under-rearmed")
    return "a revealed nearer boundary under an ancestor that `on` re-armed: whether the ancestor's re-arm owns a read the nearest boundary does not";
  if ((c.family === "revealed" || c.family === "none") && c.ownLoad)
    return "in-flush mount with no catcher and a first load of its own: the hold waits on it today (SPEC 'Not yet one-way', recorded, not ruled)";
  if (c.family === "held-cond" && !c.boundary && c.ownLoad)
    return "content mounted by a hold's commit with a first load of its own and no boundary: when it appears";
}

// ---------------------------------------------------------------------------
// Generation

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const families: MountFamily[] = [
  "fresh",
  "fresh",
  "rearm-mount",
  "rearm-committed",
  "revealed",
  "none",
  "revealed-under-pending",
  "revealed-under-rearmed",
  "held-cond",
  "verdict",
  "lane",
  "lane"
];

/** Families generated without the screen anchor too (coverage: the screen
 * value is then an untracked read or unobserved). */
const withoutAnchor: MountFamily[] = ["fresh", "rearm-mount", "rearm-committed", "verdict"];

export function generateMountCases(seed: number, count: number): MountCase[] {
  const rand = prng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  // Revision-21 dimensions draw from their own stream so case i keeps every
  // revision-20 field.
  const rand21 = prng(seed ^ 0x5bd1e995);
  const cases: MountCase[] = [];
  for (let i = 0; i < count; i++) {
    const family = pick(families);
    const c: MountCase = {
      kind: "mount-under-hold",
      version: 1,
      family,
      hold: pick(["action", "flight"] as const),
      trigger: "flip",
      show: pick(["effect", "memo"] as const),
      content: pick(["memo", "direct", "bound"] as const),
      ownLoad: rand() < 0.3,
      keyed: rand() < 0.3,
      boundary: true,
      value: 1 + Math.floor(rand() * 3),
      anchorLast: rand() < 0.3
    };
    switch (family) {
      case "fresh":
        c.trigger = pick(["flip", "flip", "root", "same-tick"] as const);
        if (rand() < 0.25) c.content = "nested";
        break;
      case "rearm-mount":
      case "rearm-committed":
      case "revealed":
      case "none":
        c.trigger = rand() < 0.15 ? "same-tick" : "flip";
        break;
      case "revealed-under-pending":
      case "revealed-under-rearmed":
        c.ownLoad = false;
        break;
      case "held-cond":
        c.trigger = "hold";
        c.boundary = rand() < 0.7;
        if (c.boundary && rand() < 0.25) c.content = "nested";
        break;
      case "verdict":
        c.trigger = "hold";
        c.hold = "action";
        if (rand() < 0.25) c.content = "nested";
        break;
      case "lane":
        c.trigger = "hold";
        c.hold = "action";
        c.ownLoad = false;
        c.content = "bound";
        c.lane = { wrap: rand() < 0.5, reads: pick(["held", "guess", "derived"] as const) };
        break;
    }
    if (c.family !== "fresh" && c.family !== "revealed") c.keyed = false;
    const noAnchor = rand21() < 0.35;
    const outerRead = rand21() < 0.5;
    c.anchor = !(withoutAnchor.includes(c.family) && noAnchor);
    if (c.family === "fresh" && c.content === "nested") c.outerRead = outerRead;
    cases.push(c);
  }
  return cases;
}

export function validateMountCase(c: MountCase): string | undefined {
  if (c.kind !== "mount-under-hold" || c.version !== 1) return "Invalid mount case";
  if (!families.includes(c.family)) return "Invalid mount family";
  if (!Number.isInteger(c.value) || c.value < 1 || c.value > 100) return "Invalid held value";
  const hold = c.trigger === "hold";
  if (hold !== (c.family === "held-cond" || c.family === "verdict" || c.family === "lane"))
    return "Invalid trigger for family";
  if (c.trigger === "root" && c.family !== "fresh") return "A root mount needs a fresh boundary";
  if ((c.family === "verdict" || c.family === "lane") && c.hold !== "action")
    return "Verdict and lane mounts need an action";
  if (c.family === "lane" && (!c.lane || c.content !== "bound" || c.ownLoad))
    return "Invalid lane case";
  if (
    c.content === "nested" &&
    c.family !== "fresh" &&
    c.family !== "verdict" &&
    !(c.family === "held-cond" && c.boundary)
  )
    return "Nested content needs a new boundary";
  if (!anchored(c) && !withoutAnchor.includes(c.family)) return "This family needs the anchor";
  if (c.outerRead && !(c.family === "fresh" && c.content === "nested"))
    return "An outer read needs nested fresh content";
}

// ---------------------------------------------------------------------------
// Judgment

const contentValue = /content (-?\d+)/g;

export function judge(c: MountCase, snapshots: MountSnapshot[], result: RunResult) {
  const fail = (rule: string, message: string, at: Checkpoint, expected: unknown) => {
    result.status = "fail";
    result.failure = {
      rule,
      message: `[${c.family}] ${message}`,
      expected: { at, expected, timeline: snapshots, unruled: unruled(c) ?? null }
    };
  };
  const V = c.value;
  const checks = expectations(c);
  // The first wrong checkpoint decides; at it, a ruled timeline step is
  // reported before the general tearing invariant.
  for (const s of snapshots) {
    for (const check of checks) {
      // When the hold itself mounts, S1 is already the mount's checkpoint.
      const applies =
        check.at === s.at || (c.trigger === "hold" && check.at === "S2" && s.at === "S1");
      if (!applies) continue;
      if (check.seen !== undefined && s.seen !== check.seen)
        return fail(check.rule, check.message, check.at, check.seen);
      if (check.notSeen !== undefined && s.seen.includes(check.notSeen))
        return fail(check.rule, check.message, check.at, { not: check.notSeen });
      // Without the anchor a flight hold's screen value is not observed.
      if (check.x !== undefined && s.x !== undefined && s.x !== check.x)
        return fail(check.rule, check.message, check.at, { x: check.x });
    }
    // MH5: never torn; visible content agrees with its world.
    if (s.seen.includes("torn:"))
      return fail(
        "MH5",
        `an element and its bindings (or a control and its content) were observed in different worlds: ${s.seen.match(/torn:[a-z-]+/)![0]}`,
        s.at,
        "control, element and bindings together"
      );
    for (const [, n] of s.seen.matchAll(contentValue)) {
      if (s.x === undefined) break;
      const world = c.family === "lane" && c.lane!.reads === "guess" && s.running ? V : s.x;
      if (Number(n) !== world)
        return fail(
          "MH5",
          "visible content disagrees with the screen's value of what it reads (torn frame)",
          s.at,
          `content ${world}`
        );
    }
  }
  // MH7: everything settles to the final view.
  const final = snapshots.find(s => s.at === "S4")!;
  const done = c.content === "nested" && c.family !== "lane" ? `[content ${V}]` : `content ${V}`;
  if ((final.x !== undefined && final.x !== V) || final.seen !== done)
    return fail("MH7", "the view did not converge once every hold and load settled", "S4", {
      x: V,
      seen: done
    });
}

// ---------------------------------------------------------------------------
// Reduction: one dimension at a time toward the simplest value, keeping the
// fingerprint (focused) or any semantic failure (discovery).

const simpler: Array<[keyof MountCase, unknown]> = [
  ["anchorLast", false],
  ["ownLoad", false],
  ["keyed", false],
  ["value", 1],
  ["hold", "action"],
  ["outerRead", false],
  ["content", "direct"],
  ["content", "memo"],
  ["show", "memo"],
  ["show", "effect"],
  ["boundary", true],
  ["trigger", "flip"]
];

export async function shrinkMountCase(
  original: RunResult,
  run: (s: Scenario) => Promise<RunResult>,
  budget: number,
  accept: (r: RunResult) => boolean
): Promise<{ result: RunResult; attempts: number; exhausted: boolean }> {
  let best = original;
  let attempts = 0;
  let progress = true;
  while (progress && attempts < budget) {
    progress = false;
    for (const [field, value] of simpler) {
      const current = best.scenario as unknown as MountCase;
      if (current[field] === value) continue;
      const next = { ...current, [field]: value } as unknown as MountCase;
      if (field === "content" && next.lane) continue;
      if (validateMountCase(next)) continue;
      if (attempts++ >= budget) break;
      const r = await run(next as unknown as Scenario);
      if (accept(r)) {
        best = r;
        progress = true;
      }
    }
  }
  return { result: best, attempts, exhausted: attempts >= budget };
}

export const mountCaseKey = (c: MountCase) => JSON.stringify(c);

/** Report-queue variety: family and hold kind. A heuristic, not a bug identity. */
export const mountShape = (c: MountCase) =>
  families.indexOf(c.family) * 8 +
  (anchored(c) ? 4 : 0) +
  (c.hold === "flight" ? 2 : 0) +
  (c.ownLoad ? 1 : 0);

/** Prefer simpler cases for detailed reports and reduction. */
export const mountComplexity = (c: MountCase) =>
  (c.ownLoad ? 4 : 0) +
  (c.hold === "flight" ? 2 : 0) +
  (c.content === "nested" ? 3 : c.content === "bound" ? 2 : c.content === "memo" ? 1 : 0) +
  (c.keyed ? 1 : 0) +
  (c.anchorLast ? 1 : 0) +
  (c.value - 1);
