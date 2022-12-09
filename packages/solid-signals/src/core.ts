/**
 * Nodes for constructing a reactive graph of reactive values and reactive computations.
 * The graph is acyclic.
 * The user inputs new values into the graph by calling set() on one more more reactive nodes.
 * The user retrieves computed results from the graph by calling get() on one or more reactive nodes.
 * The library is responsible for running any necessary reactive computations so that get() is
 * up to date with all prior set() calls anywhere in the graph.
 *
 * We call input nodes 'roots' and the output nodes 'leaves' of the graph here in discussion,
 * but the distinction is based on the use of the graph, all nodes have the same internal structure.
 * Changes flow from roots to leaves. It would be effective but inefficient to immediately propagate
 * all changes from a root through the graph to descendant leaves. Instead we defer change
 * most change progogation computation until a leaf is accessed. This allows us to coalesce computations
 * and skip altogether recalculating unused sections of the graph.
 *
 * Each reactive node tracks its sources and its observers (observers are other
 * elements that have this node as a source). Source and observer links are updated automatically
 * as observer reactive computations re-evaluate and call get() on their sources.
 *
 * Each node stores a cache state to support the change propogation algorithm: 'clean', 'check', or 'dirty'
 * In general, execution proceeds in three passes:
 *  1. set() propogates changes down the graph to the leaves
 *     direct children are marked as dirty and their deeper descendants marked as check
 *     (no reactive computations are evaluated)
 *  2. get() requests that parent nodes updateIfNecessary(), which proceeds recursively up the tree
 *     to decide whether the node is clean (parents unchanged) or dirty (parents changed)
 *  3. updateIfNecessary() evaluates the reactive computation if the node is dirty
 *     (the computations are executed in root to leaf order)
 */

/** current capture context for identifying @reactive sources (other reactive elements) and cleanups
 * - active while evaluating a reactive function body  */
export let CurrentReaction: Reactive<any> | undefined = undefined;
let CurrentGets: Reactive<any>[] | null = null;
let CurrentGetsIndex = 0;

/** A list of non-clean 'effect' nodes that will be updated when stabilize() is called */
let EffectQueue: Reactive<any>[] | null = null;

/** reactive nodes are marked dirty when their source values change TBD*/
const CacheClean = 0; // reactive value is valid, no need to recompute
const CacheCheck = 1; // reactive value might be stale, check parent nodes to decide whether to recompute
const CacheDirty = 2; // reactive value is invalid, parents have changed, valueneeds to be recomputed
type CacheState = typeof CacheClean | typeof CacheCheck | typeof CacheDirty;
type CacheNonClean = typeof CacheCheck | typeof CacheDirty;
type SetterArg<T> = Exclude<T, Function> | ((prev: T) => T);
export type Accessor<T> = () => T;
export type Setter<T> = (value: SetterArg<T>) => T;
export type Signal<T> = [get: Accessor<T>, set: Setter<T>];

let Root: Reactive<any>[] | null;
/** A reactive element contains a mutable value that can be observed by other reactive elements.
 *
 * The property can be modified externally by calling set().
 *
 * Reactive elements may also contain a 0-ary function body that produces a new value using
 * values from other reactive elements.
 *
 * Dependencies on other elements are captured dynamically as the 'reactive' function body executes.
 *
 * The reactive function is re-evaluated when any of its dependencies change, and the result is
 * cached.
 */
class Reactive<T> {
  private value: T;
  private fn?: () => T;
  private observers: Reactive<any>[] | null = null; // nodes that have us as sources (down links)
  private sources: Reactive<any>[] | null = null; // sources in reference order, not deduplicated (up links)

  private state: CacheState;
  private effect: boolean;
  cleanups: (() => void)[] | null = null;
  alwaysUpdate: boolean = false;

  constructor(fnOrValue: (() => T) | T, effect?: boolean) {
    if (typeof fnOrValue === "function") {
      this.fn = fnOrValue as () => T;
      this.value = undefined as any;
      this.effect = effect || false;
      this.state = CacheDirty;
      if (Root) Root.push(this);
      else console.error("Memos and effects must be wrapped in a createRoot");
      if (effect) this.update(); // CONSIDER removing this?
    } else {
      this.fn = undefined;
      this.value = fnOrValue;
      this.state = CacheClean;
      this.effect = false;
    }
  }

  get(): T {
    if (CurrentReaction) {
      if (
        !CurrentGets &&
        CurrentReaction.sources &&
        CurrentReaction.sources[CurrentGetsIndex] == this
      ) {
        CurrentGetsIndex++;
      } else {
        if (!CurrentGets) CurrentGets = [this];
        else CurrentGets.push(this);
      }
    }
    if (this.fn) this.updateIfNecessary();
    return this.value;
  }

  set(value: SetterArg<T>): void {
    const newValue =
      typeof value === "function" ? (value as Function)(this.value) : value;
    if ((this.value !== newValue || this.alwaysUpdate) && this.observers) {
      for (let i = 0; i < this.observers.length; i++) {
        this.observers[i].stale(CacheDirty);
      }
    }
    this.value = newValue;
  }

  private stale(state: CacheNonClean): void {
    if (this.state < state) {
      // If we were previously clean, then we know that we may need to update to get the new value
      if (this.state === CacheClean && this.effect) {
        if (EffectQueue) EffectQueue.push(this);
        else EffectQueue = [this];
      }

      this.state = state;
      if (this.observers) {
        for (let i = 0; i < this.observers.length; i++) {
          this.observers[i].stale(CacheCheck);
        }
      }
    }
  }

  /** run the computation fn, updating the cached value */
  private update(): void {
    const oldValue = this.value;

    /* Evalute the reactive function body, dynamically capturing any other reactives used */
    const prevReaction = CurrentReaction;
    const prevGets = CurrentGets;
    const prevIndex = CurrentGetsIndex;

    CurrentReaction = this;
    CurrentGets = null as any; // prevent TS from thinking CurrentGets is null below
    CurrentGetsIndex = 0;

    try {
      if (this.cleanups) {
        this.cleanups.forEach((c) => c());
        this.cleanups = null;
      }
      this.value = this.fn!();

      // if the sources have changed, update source & observer links
      if (CurrentGets) {
        // remove all old sources' .observers links to us
        this.removeParentObservers(CurrentGetsIndex);
        // update source up links
        if (this.sources && CurrentGetsIndex > 0) {
          this.sources.length = CurrentGetsIndex + CurrentGets.length;
          for (let i = 0; i < CurrentGets.length; i++) {
            this.sources[CurrentGetsIndex + i] = CurrentGets[i];
          }
        } else {
          this.sources = CurrentGets;
        }

        for (let i = CurrentGetsIndex; i < this.sources.length; i++) {
          // Add ourselves to the end of the parent .observers array
          const source = this.sources[i];
          if (!source.observers) {
            source.observers = [this];
          } else {
            source.observers.push(this);
          }
        }
      } else if (this.sources && CurrentGetsIndex < this.sources.length) {
        // remove all old sources' .observers links to us
        this.removeParentObservers(CurrentGetsIndex);
        this.sources.length = CurrentGetsIndex;
      }
    } finally {
      CurrentGets = prevGets;
      CurrentReaction = prevReaction;
      CurrentGetsIndex = prevIndex;
    }

    // handle diamond depenendencies if we're the parent of a diamond.
    if ((oldValue !== this.value || this.alwaysUpdate) && this.observers) {
      // We've changed value, so mark our children as dirty so they'll reevaluate
      for (let i = 0; i < this.observers.length; i++) {
        this.observers[i].state = CacheDirty;
      }
    }

    // We've rerun with the latest values from all of our sources.
    // This means that we no longer need to update until a signal changes
    this.state = CacheClean;
  }

  /** update() if dirty, or a parent turns out to be dirty. */
  private updateIfNecessary(): void {
    // If we are potentially dirty, see if we have a parent who has actually changed value
    if (this.state === CacheCheck) {
      for (const source of this.sources!) {
        source.updateIfNecessary(); // updateIfNecessary() can change this.state
        if ((this.state as CacheState) === CacheDirty) {
          // Stop the loop here so we won't trigger updates on other parents unnecessarily
          // If our computation changes to no longer use some sources, we don't
          // want to update() a source we used last time, but now don't use.
          break;
        }
      }
    }

    // If we were already dirty or marked dirty by the step above, update.
    if (this.state === CacheDirty) {
      this.update();
    }

    // By now, we're clean
    this.state = CacheClean;
  }

  private removeParentObservers(index: number): void {
    if (!this.sources) return;
    for (let i = index; i < this.sources!.length; i++) {
      const source: Reactive<any> = this.sources![i]; // We don't actually delete sources here because we're replacing the entire array soon
      const swap = source.observers!.findIndex((v) => v === this);
      source.observers![swap] = source.observers![source.observers!.length - 1];
      source.observers!.pop();
    }
  }

  destroy(): void {
    if (this.cleanups) {
      this.cleanups.forEach((c) => c());
      this.cleanups = null;
    }
    this.removeParentObservers(0);
  }
}

export function onCleanup(fn: () => void): void {
  if (CurrentReaction) {
    if (!CurrentReaction.cleanups) CurrentReaction.cleanups = [fn];
    else CurrentReaction.cleanups.push(fn);
  } else {
    console.error("onCleanup must be called from within a memo or effect");
  }
}

/** run all non-clean effect nodes */
function stabilize() {
  if (!EffectQueue) return;
  for (let i = 0; i < EffectQueue.length; i++) {
    EffectQueue[i].get();
  }
  EffectQueue = null;
}

function setSignal<T>(this: Reactive<T>, value: SetterArg<T>) {
  const notInBatch = !EffectQueue;
  this.set(value);
  if (notInBatch) stabilize();
}
export function createSignal<T>(
  value: T,
  options?: { equals?: false }
): Signal<T> {
  const signal = new Reactive(value);
  if (options?.equals !== undefined) signal.alwaysUpdate = true;
  return [
    signal.get.bind(signal),
    (setSignal as typeof setSignal<T>).bind(signal) as Setter<T>,
  ];
}
export function createMemo<T>(fn: () => T): () => T {
  const memo = new Reactive(fn);
  return memo.get.bind(memo);
}
export function createEffect(fn: () => void) {
  const effect = new Reactive(fn, true);
  return effect.get.bind(effect);
}
export function createRoot(fn: () => void) {
  let root: Reactive<any>[] = [];
  Root = root;
  fn();
  Root = null;
  return () => {
    root.forEach((r) => r.destroy());
    root = null as any;
  };
}
export function batch<T>(fn: () => T): T {
  EffectQueue = [];
  let out = fn();
  stabilize();
  return out;
}
export function untrack<T>(fn: () => T): T {
  const listener = CurrentReaction;
  CurrentReaction = undefined;
  try {
    return fn();
  } finally {
    CurrentReaction = listener;
  }
}
