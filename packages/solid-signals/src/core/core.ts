/**
 * Nodes for constructing a graph of reactive values and reactive computations.
 *
 * - The graph is acyclic.
 * - The user inputs new values into the graph by calling .write() on one more computation nodes.
 * - The user retrieves computed results from the graph by calling .read() on one or more computation nodes.
 * - The library is responsible for running any necessary computations so that .read() is up to date
 *   with all prior .write() calls anywhere in the graph.
 * - We call the input nodes 'roots' and the output nodes 'leaves' of the graph here.
 * - Changes flow from roots to leaves. It would be effective but inefficient to immediately
 *   propagate all changes from a root through the graph to descendant leaves. Instead, we defer
 *   change most change propagation computation until a leaf is accessed. This allows us to
 *   coalesce computations and skip altogether recalculating unused sections of the graph.
 * - Each computation node tracks its sources and its observers (observers are other
 *   elements that have this node as a source). Source and observer links are updated automatically
 *   as observer computations re-evaluate and call get() on their sources.
 * - Each node stores a cache state (clean/check/dirty) to support the change propagation algorithm:
 *
 * In general, execution proceeds in three passes:
 *
 *  1. write() propagates changes down the graph to the leaves
 *     direct children are marked as dirty and their deeper descendants marked as check
 *     (no computations are evaluated)
 *  2. read() requests that parent nodes updateIfNecessary(), which proceeds recursively up the tree
 *     to decide whether the node is clean (parents unchanged) or dirty (parents changed)
 *  3. updateIfNecessary() evaluates the computation if the node is dirty (the computations are
 *     executed in root to leaf order)
 */

import { STATE_CHECK, STATE_CLEAN, STATE_DIRTY, STATE_DISPOSED } from "./constants.js";
import { NotReadyError } from "./error.js";
import { DEFAULT_FLAGS, ERROR_BIT, LOADING_BIT, UNINITIALIZED_BIT, type Flags } from "./flags.js";
import { getOwner, Owner, setOwner } from "./owner.js";
import { ActiveTransition, clock, cloneGraph, removeSourceObservers, getTransitionSource, initialDispose, type Transition } from "./scheduler.js";

export interface SignalOptions<T> {
  id?: string;
  name?: string;
  equals?: ((prev: T, next: T) => boolean) | false;
  pureWrite?: boolean;
  unobserved?: () => void;
}

export interface SourceType {
  _observers: ObserverType[] | null;
  _unobserved?: () => void;
  _updateIfNecessary: () => void;
  _stateFlags: Flags;
  _time: number;

  _transition?: Transition;
  _cloned?: Computation;
}

export interface ObserverType {
  _sources: SourceType[] | null;
  _notify: (state: number, skipQueue?: boolean) => void;

  _handlerMask: Flags;
  _notifyFlags: (mask: Flags, newFlags: Flags) => void;
  _time: number;
  _cloned?: Computation;
}

let currentObserver: ObserverType | null = null,
  currentMask: Flags = DEFAULT_FLAGS,
  newSources: SourceType[] | null = null,
  newSourcesIndex = 0,
  newFlags = 0,
  notStale = false,
  updateCheck: null | { _value: boolean } = null,
  staleCheck: null | { _value: boolean } = null;

/**
 * Returns the current observer.
 */
export function getObserver(): Computation | null {
  return currentObserver as Computation | null;
}

export const UNCHANGED: unique symbol = Symbol(__DEV__ ? "unchanged" : 0);
export type UNCHANGED = typeof UNCHANGED;

export class Computation<T = any> extends Owner implements SourceType, ObserverType {
  _sources: SourceType[] | null = null;
  _observers: ObserverType[] | null = null;
  _value: T | undefined;
  _error: unknown;
  _compute: null | ((p?: T) => T);

  // Used in __DEV__ mode, hopefully removed in production
  _name: string | undefined;

  // Using false is an optimization as an alternative to _equals: () => false
  // which could enable more efficient DIRTY notification
  _equals: false | ((a: T, b: T) => boolean) = isEqual;
  _unobserved: (() => void) | undefined;
  _pureWrite: boolean = false;

  /** Whether the computation is an error or has ancestors that are unresolved */
  _stateFlags = 0;

  /** Which flags raised by sources are handled, vs. being passed through. */
  _handlerMask = DEFAULT_FLAGS;

  _time: number = -1;
  _forceNotify = false;
  _transition?: Transition | undefined;
  _cloned?: Computation;
  _optimistic?: (() => void) & { _transition?: Transition };

  constructor(
    initialValue: T | undefined,
    compute: null | ((p?: T) => T),
    options?: SignalOptions<T>
  ) {
    // Initialize self as a node in the Owner tree, for tracking cleanups.
    // If we aren't passed a compute function, we don't need to track nested computations
    // because there is no way to create a nested computation (a child to the owner tree)
    super(options?.id, compute === null);

    this._compute = compute;

    this._state = compute ? STATE_DIRTY : STATE_CLEAN;
    this._stateFlags = compute && initialValue === undefined ? UNINITIALIZED_BIT : 0;
    this._value = initialValue;

    // Used when debugging the graph; it is often helpful to know the names of sources/observers
    if (__DEV__) this._name = options?.name ?? (this._compute ? "computed" : "signal");

    if (options?.equals !== undefined) this._equals = options.equals;
    this._pureWrite = !!options?.pureWrite;
    this._unobserved = options?.unobserved;

    if (ActiveTransition) {
      this._transition = ActiveTransition;
      ActiveTransition._sources.set(this, this);
    }
  }

  _read(): T {
    // When the currentObserver reads this._value, the want to add this computation as a source
    // so that when this._value changes, the currentObserver will be re-executed
    track(this);

    // TODO do a handler lookup instead
    newFlags |= this._stateFlags & ~currentMask;

    if (this._stateFlags & ERROR_BIT) {
      throw this._error as Error;
    } else {
      return this._value!;
    }
  }

  /**
   * Return the current value of this computation
   * Automatically re-executes the surrounding computation when the value changes
   */
  read(): T {
    if (
      ActiveTransition &&
      (ActiveTransition._sources.has(this) ||
        (!this._cloned && (this._stateFlags & (UNINITIALIZED_BIT | ERROR_BIT))))
    ) {
      const clone = ActiveTransition._sources.get(this)! || cloneGraph(this);
      if (clone !== this) return clone.read();
    }
    if (this._compute) {
      if (this._stateFlags & ERROR_BIT && this._time <= clock) update(this);
      else this._updateIfNecessary();
    }

    return this._read();
  }

  /**
   * Return the current value of this computation
   * Automatically re-executes the surrounding computation when the value changes
   *
   * If the computation has any unresolved ancestors, this function waits for the value to resolve
   * before continuing
   */
  wait(): T {
    if (
      ActiveTransition &&
      (ActiveTransition._sources.has(this) ||
        (!this._cloned && (this._stateFlags & (UNINITIALIZED_BIT | ERROR_BIT))))
    ) {
      const clone = ActiveTransition._sources.get(this)! || cloneGraph(this);
      if (clone !== this) return clone.wait();
    }
    if (this._compute) {
      if (this._stateFlags & ERROR_BIT && this._time <= clock) update(this);
      else this._updateIfNecessary();
    }

    if ((notStale || this._stateFlags & UNINITIALIZED_BIT) && this._stateFlags & LOADING_BIT) {
      throw new NotReadyError(this);
    }

    if (staleCheck && this._stateFlags & LOADING_BIT) {
      staleCheck._value = true;
    }

    return this._read();
  }

  /** Update the computation with a new value. */
  write(
    value: T | ((currentValue: T) => T) | UNCHANGED,
    flags = 0,
    // Tracks whether a function was returned from a compute result so we don't unwrap it.
    raw = false
  ): T {
    if (ActiveTransition && !this._cloned) {
      const clone = cloneGraph(this);
      if (clone !== this) return clone.write(value, flags, raw);
    }

    // Warn about writing to a signal in an owned scope in development mode.
    if (
      __DEV__ &&
      !this._compute &&
      !(this as any)._pureWrite &&
      getOwner() &&
      !(getOwner() as any).firewall
    )
      console.warn("A Signal was written to in an owned scope.");

    const newValue =
      !raw && typeof value === "function"
        ? (value as (currentValue: T) => T)(this._value!)
        : (value as T);

    const valueChanged =
      newValue !== UNCHANGED &&
      (!!(this._stateFlags & UNINITIALIZED_BIT) ||
        // this._stateFlags & LOADING_BIT & ~flags ||
        this._equals === false ||
        !this._equals(this._value!, newValue));

    if (valueChanged) {
      this._value = newValue;
      this._error = undefined;
    }

    const changedFlagsMask = this._stateFlags ^ flags,
      changedFlags = changedFlagsMask & flags;

    this._stateFlags = flags;
    this._time = clock + 1;

    // Our value has changed, so we need to notify all of our observers that the value has
    // changed and so they must rerun
    if (this._observers && !(this._optimistic && ActiveTransition)) {
      for (let i = 0; i < this._observers.length; i++) {
        if (valueChanged) {
          this._observers[i]._notify(STATE_DIRTY);
        } else if (changedFlagsMask) {
          this._observers[i]._notifyFlags(changedFlagsMask, changedFlags);
        }
      }
    }

    // We return the value so that .write can be used in an expression
    // (although it is not usually recommended)
    return this._value!;
  }

  /**
   * Set the current node's state, and recursively mark all of this node's observers as STATE_CHECK
   */
  _notify(state: number, skipQueue?: boolean): void {
    // If the state is already STATE_DIRTY and we are trying to set it to STATE_CHECK,
    // then we don't need to do anything. Similarly, if the state is already STATE_CHECK
    // and we are trying to set it to STATE_CHECK, then we don't need to do anything because
    // a previous _notify call has already set this state and all observers as STATE_CHECK
    if (this._state >= state && !this._forceNotify) return;

    this._forceNotify = !!skipQueue;
    this._state = state;

    if (this._observers && !(this._optimistic && ActiveTransition)) {
      for (let i = 0; i < this._observers.length; i++) {
        this._observers[i]._notify(STATE_CHECK, skipQueue);
      }
    }
  }

  /**
   * Notify the computation that one of its sources has changed flags.
   *
   * @param mask A bitmask for which flag(s) were changed.
   * @param newFlags The source's new flags, masked to just the changed ones.
   */
  _notifyFlags(mask: Flags, newFlags: Flags): void {
    // If we're dirty, none of the things we do can matter.
    if (this._state >= STATE_DIRTY) return;

    // If the changed flags have side effects attached, we have to re-run.
    if (mask & this._handlerMask || this._optimistic && ActiveTransition) {
      this._notify(STATE_DIRTY);
      return;
    }

    // If we're already check, we can delay this propagation until we check.
    if (this._state >= STATE_CHECK && !this._forceNotify) return;

    // If we're clean, and none of these flags have a handler, we can try to
    // propagate them.
    const prevFlags = this._stateFlags & mask;
    const deltaFlags = prevFlags ^ newFlags;

    if (newFlags === prevFlags) {
      // No work to do if the flags are unchanged.
    } else if (deltaFlags & prevFlags & mask) {
      // One of the changed flags was previously _on_, so we can't eagerly
      // propagate anything; we'll wait until we're checked.
      this._notify(STATE_CHECK);
    } else {
      // The changed flags were previously _off_, which means we can remain
      // clean with updated flags and pass this notification on transitively.
      this._stateFlags ^= deltaFlags;
      if (this._observers) {
        for (let i = 0; i < this._observers.length; i++) {
          this._observers[i]._notifyFlags(mask, newFlags);
        }
      }
    }
  }

  _setError(error: unknown): void {
    if (ActiveTransition && !this._cloned) {
      const clone = cloneGraph(this);
      if (clone !== this) return clone._setError(error);
    }
    this._error = error;
    this.write(UNCHANGED, (this._stateFlags & ~LOADING_BIT) | ERROR_BIT | UNINITIALIZED_BIT);
  }

  /**
   * This is the core part of the reactivity system, which makes sure that the values are updated
   * before they are read. We've also adapted it to return the loading state of the computation,
   * so that we can propagate that to the computation's observers.
   *
   * This function will ensure that the value and states we read from the computation are up to date
   */
  _updateIfNecessary(): void {
    if (!this._compute) {
      return;
    }

    // If the user tries to read a computation that has been disposed, we throw an error, because
    // they probably kept a reference to it as the parent reran, so there is likely a new computation
    // with the same _compute function that they should be reading instead.
    if (this._state === STATE_DISPOSED) {
      return;
      // throw new Error("Tried to read a disposed computation");
    }

    // If the computation is already clean, none of our sources have changed, so we know that
    // our value and stateFlags are up to date, and we can just return.
    if (this._state === STATE_CLEAN) {
      return;
    }

    // Otherwise, our sources' values may have changed, or one of our sources' loading states
    // may have been set to no longer loading. In either case, what we need to do is make sure our
    // sources all have up to date values and loading states and then update our own value and
    // loading state

    // We keep track of whether any of our sources have changed loading state so that we can update
    // our loading state. This is only necessary if none of them change value because update() will
    // also cause us to recompute our loading state.
    let observerFlags: Flags = 0;

    // STATE_CHECK means one of our grandparent sources may have changed value or loading state,
    // so we need to recursively call _updateIfNecessary to update the state of all of our sources
    // and then update our value and loading state.
    if (this._state === STATE_CHECK) {
      for (let i = 0; i < this._sources!.length; i++) {
        const source = getTransitionSource(this._sources![i] as any);
        // Make sure the parent is up to date. If it changed value, then it will mark us as
        // STATE_DIRTY, and we will know to rerun
        source._updateIfNecessary();

        // If the parent is loading, then we are waiting
        observerFlags |= source._stateFlags & ~UNINITIALIZED_BIT;

        // If the parent changed value, it will mark us as STATE_DIRTY and we need to call update()
        // Cast because the _updateIfNecessary call above can change our state
        if ((this._state as number) === STATE_DIRTY) {
          // Stop the loop here so we won't trigger updates on other parents unnecessarily
          // If our computation changes to no longer use some sources, we don't
          // want to update() a source we used last time, but now don't use.
          break;
        }
      }
    }

    if (this._state === STATE_DIRTY) {
      update(this);
    } else {
      // isWaiting has now coallesced all of our parents' loading states
      this.write(UNCHANGED, observerFlags);

      // None of our parents changed value, so our value is up to date (STATE_CLEAN)
      this._state = STATE_CLEAN;
    }
  }

  /**
   * Remove ourselves from the owner graph and the computation graph
   */
  override _disposeNode(): void {
    // If we've already been disposed, don't try to dispose twice
    if (this._state === STATE_DISPOSED) return;

    // Unlink ourselves from our sources' observers array so that we can be garbage collected
    // This removes us from the computation graph
    if (this._sources) removeSourceObservers(this, 0);

    // Remove ourselves from the ownership tree as well
    super._disposeNode();
  }
}

/**
 * Instead of wiping the sources immediately on `update`, we compare them to the new sources
 * by checking if the source we want to add is the same as the old source at the same index.
 *
 * This way when the sources don't change, we are just doing a fast comparison:
 *
 * _sources: [a, b, c]
 *            ^
 *            |
 *      newSourcesIndex
 *
 * When the sources do change, we create newSources and push the values that we read into it
 */
function track(computation: SourceType): void {
  if (ActiveTransition && computation._cloned) computation = computation._cloned;
  if (currentObserver) {
    if (
      !newSources &&
      currentObserver._sources &&
      currentObserver._sources[newSourcesIndex] === computation
    ) {
      newSourcesIndex++;
    } else if (!newSources) newSources = [computation];
    else if (computation !== newSources[newSources.length - 1]) {
      // If the computation is the same as the last source we read, we don't need to add it to newSources
      // https://github.com/solidjs/solid/issues/46#issuecomment-515717924
      newSources.push(computation);
    }
    if (updateCheck) {
      updateCheck._value = computation._time > currentObserver._time;
    }
  }
}

/**
 * Reruns a computation's _compute function, producing a new value and keeping track of dependencies.
 *
 * It handles the updating of sources and observers, disposal of previous executions,
 * and error handling if the _compute function throws. It also sets the node as loading
 * if it reads any parents that are currently loading.
 */
export function update<T>(node: Computation<T>): void {
  const prevSources = newSources,
    prevSourcesIndex = newSourcesIndex,
    prevFlags = newFlags;

  newSources = null as Computation[] | null;
  newSourcesIndex = 0;
  newFlags = 0;

  try {
    if (ActiveTransition && node._cloned && !(node as any)._updated) {
      initialDispose(node._cloned);
      (node as any)._updated = true;
    }
    node.dispose(false);
    node.emptyDisposal();

    // Rerun the node's _compute function, setting node as owner and listener so that any
    // computations read are added to node's sources and any computations are automatically disposed
    // if `node` is rerun
    const result = compute(node, node._compute!, node);

    // Update the node's value
    node.write(result, newFlags, true);
  } catch (error) {
    if (error instanceof NotReadyError) {
      if (error.cause !== node) compute(node, () => track(error.cause as SourceType), node as Computation);
      node.write(UNCHANGED, newFlags | LOADING_BIT | (node._stateFlags & UNINITIALIZED_BIT));
    } else {
      node._setError(error);
    }
  } finally {
    if (newSources) {
      // If there are new sources, that means the end of the sources array has changed
      // newSourcesIndex keeps track of the index of the first new source
      // See track() above for more info

      // We need to remove any old sources after newSourcesIndex
      if (node._sources) removeSourceObservers(node, newSourcesIndex);

      // First we update our own sources array (uplinks)
      if (node._sources && newSourcesIndex > 0) {
        // If we shared some sources with the previous execution, we need to copy those over to the
        // new sources array

        // First we need to make sure the sources array is long enough to hold all the new sources
        node._sources.length = newSourcesIndex + newSources.length;

        // Then we copy the new sources over
        for (let i = 0; i < newSources.length; i++) {
          node._sources[newSourcesIndex + i] = newSources[i];
        }
      } else {
        // If we didn't share any sources with the previous execution, set the sources array to newSources
        node._sources = newSources;
      }

      // For each new source, we need to add this `node` to the source's observers array (downlinks)
      let source: SourceType;
      for (let i = newSourcesIndex; i < node._sources.length; i++) {
        source = getTransitionSource(node._sources![i] as any);
        if (!source._observers) source._observers = [node];
        else source._observers.push(node);
      }
    } else if (node._sources && newSourcesIndex < node._sources.length) {
      // If there are no new sources, but the sources array is longer than newSourcesIndex,
      // that means the sources array has just shrunk so we remove the tail end
      removeSourceObservers(node, newSourcesIndex);
      node._sources.length = newSourcesIndex;
    }

    // Reset global context after computation
    newSources = prevSources;
    newSourcesIndex = prevSourcesIndex;
    newFlags = prevFlags;

    node._time = clock + 1;

    // By now, we have updated the node's value and sources array, so we can mark it as clean
    // TODO: This assumes that the computation didn't write to any signals, throw an error if it did
    node._state = STATE_CLEAN;
  }
}

export function isEqual<T>(a: T, b: T): boolean {
  return a === b;
}

/**
 * Returns the current value stored inside the given compute function without triggering any
 * dependencies. Use `untrack` if you want to also disable owner tracking.
 */
export function untrack<T>(fn: () => T): T {
  if (currentObserver === null) return fn();
  return compute(getOwner(), fn, null);
}

/**
 * Returns true if the given functinon contains signals that have been updated since the last time
 * the parent computation was run.
 */
export function hasUpdated(fn: () => any): boolean {
  const current = updateCheck;
  updateCheck = { _value: false };
  try {
    fn();
    return updateCheck._value;
  } finally {
    updateCheck = current;
  }
}

function pendingCheck(fn: () => any, loadingValue: boolean | undefined): boolean {
  const current = staleCheck;
  staleCheck = { _value: false };
  try {
    latest(fn);
    return staleCheck._value;
  } catch (err) {
    if (!(err instanceof NotReadyError)) return false;
    if (loadingValue !== undefined) return loadingValue!;
    throw err;
  } finally {
    staleCheck = current;
  }
}

/**
 * Returns an accessor that is true if the given function contains async signals that are out of date.
 */
export function isPending(fn: () => any): boolean;
export function isPending(fn: () => any, loadingValue: boolean): boolean;
export function isPending(fn: () => any, loadingValue?: boolean): boolean {
  if (!currentObserver) return pendingCheck(fn, loadingValue);
  const c = new Computation(undefined, () => pendingCheck(fn, loadingValue));
  c._handlerMask |= LOADING_BIT;
  return c.wait();
}

/**
 * Attempts to resolve value of expression synchronously returning the last resolved value for any async computation.
 */
export function latest<T>(fn: () => T): T;
export function latest<T, U>(fn: () => T, fallback: U): T | U;
export function latest<T, U>(fn: () => T, fallback?: U): T | U {
  const argLength = arguments.length;
  const prevFlags = newFlags;
  const prevNotStale = notStale;
  notStale = false;
  try {
    return fn();
  } catch (err) {
    if (argLength > 1 && err instanceof NotReadyError) return fallback as U;
    throw err;
  } finally {
    newFlags = prevFlags;
    notStale = prevNotStale;
  }
}

/**
 * A convenient wrapper that calls `compute` with the `owner` and `observer` and is guaranteed
 * to reset the global context after the computation is finished even if an error is thrown.
 */
export function compute<T>(owner: Owner | null, fn: (val: T) => T, observer: Computation<T>): T;
export function compute<T>(owner: Owner | null, fn: (val: undefined) => T, observer: null): T;
export function compute<T>(
  owner: Owner | null,
  fn: (val?: T) => T,
  observer: Computation<T> | null
): T {
  const prevOwner = setOwner(owner),
    prevObserver = currentObserver,
    prevMask = currentMask,
    prevNotStale = notStale;

  currentObserver = observer;
  currentMask = observer?._handlerMask ?? DEFAULT_FLAGS;
  notStale = true;

  try {
    return fn.call(observer, observer ? observer._value : undefined);
  } finally {
    setOwner(prevOwner);
    currentObserver = prevObserver;
    currentMask = prevMask;
    notStale = prevNotStale;
  }
}
