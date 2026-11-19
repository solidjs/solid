/**
 * Time travel over `openView`, as a devtool would build it, on the published
 * entries: steps are recorded from the attribution engine's `flush` record
 * (its `changes`, with bodies), and viewing a step pins every node changed
 * after it at what it showed before that change. Test code, not shipped; the
 * signals suite keeps the same recorder against its source
 * (`packages/signals/tests/view-time-travel.ts`).
 */
import { OBSERVE } from "solid-js";
import { attribution, openView, type FlushEvent, type View } from "solid-js/attribution";

export interface TimeTravelChange {
  node: object;
  nodeName: string;
  key?: string;
  prev: unknown;
  value: unknown;
}

export interface TimeTravelOptions {
  /** Steps kept; the oldest are dropped past it. Default 100. */
  limit?: number;
  /** `openView`'s `effects`. */
  effects?: boolean;
}

type Live = { changes: { node: object; prev?: unknown; value?: unknown }[] } | undefined;

export function createTimeTravel() {
  const steps: TimeTravelChange[][] = [];
  // The last value each node was recorded showing: a landing is recorded
  // against it, not against the pin the screen showed under the view.
  const last = new WeakMap<object, unknown>();
  let limit = 100;
  let effects = false;
  let view: View | null = null;
  let viewed: number | null = null;
  let landing: View | null = null;
  let quiet = false;

  function onFlush(event: FlushEvent, live: Live): void {
    if (live === undefined || view !== null || quiet) return;
    const changes: TimeTravelChange[] = [];
    for (let i = 0; i < live.changes.length; i++) {
      const { node, prev: shownBefore, value } = live.changes[i];
      if (OBSERVE!.isExcluded(node as any)) continue;
      const prev = landing !== null && last.has(node) ? last.get(node) : shownBefore;
      last.set(node, value);
      if (Object.is(prev, value)) continue;
      const meta = event.changes[i];
      const change: TimeTravelChange = { node, nodeName: meta.nodeName, prev, value };
      if (meta.key !== undefined) change.key = meta.key;
      changes.push(change);
    }
    if (landing !== null && !landing.landing()) landing = null;
    if (changes.length === 0) return;
    steps.push(changes);
    if (steps.length > limit) steps.splice(0, steps.length - limit);
  }

  /** Each node changed after step `k`, at what it showed before its first
   * change after `k`. `-1` is before the oldest step kept. */
  function pinsFor(k: number): Map<object, unknown> {
    const out = new Map<object, unknown>();
    for (let i = steps.length - 1; i > k; i--) for (const c of steps[i]) out.set(c.node, c.prev);
    return out;
  }

  return {
    record(options?: TimeTravelOptions): () => void {
      limit = Math.max(1, options?.limit ?? 100);
      effects = options?.effects === true;
      const release = attribution.enable({ log: false });
      const unsubscribe = OBSERVE!.records.subscribe("flush", onFlush as any, { bodies: true });
      return () => (unsubscribe(), release());
    },
    steps: (): readonly TimeTravelChange[][] => steps,
    pinsFor,
    view(k: number): void {
      k = Math.max(-1, Math.min(steps.length - 1, k));
      if (view === null) {
        landing = null;
        view = openView({ effects });
      }
      view.show(pinsFor(k));
      viewed = k;
    },
    viewing: (): number | null => viewed,
    /** False while the landing waits on async work; see `landing()`. */
    resume(): boolean {
      if (view !== null) {
        landing = view;
        view = null;
        viewed = null;
        if (landing.resume()) landing = null;
      }
      return landing === null;
    },
    landing(): boolean {
      if (landing !== null && !landing.landing()) landing = null;
      return landing !== null;
    },
    branch(): void {
      if (view === null) return;
      const k = viewed!;
      const v = view;
      for (const [n, value] of pinsFor(k)) last.set(n, value);
      view = null;
      viewed = null;
      quiet = true;
      try {
        v.branch();
      } finally {
        quiet = false;
      }
      steps.length = Math.min(steps.length, k + 1);
    },
    /** Leaves any open view and forgets the steps. */
    reset(): void {
      if (view !== null) this.resume();
      landing = null;
      steps.length = 0;
    }
  };
}

export type TimeTravel = ReturnType<typeof createTimeTravel>;
