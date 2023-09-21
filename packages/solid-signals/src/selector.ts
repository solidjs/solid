import { Effect } from "./bubble-reactivity/effect";
import { isEqual, getObserver } from "./bubble-reactivity/core";
import { Accessor, onCleanup } from "./reactivity";
import { Computation } from "./reactivity";

export interface SelectorSignal<T> {
  (key: T): Boolean;
}

export interface SelectorOptions<Key, Value> {
  name?: string;
  equals?: (key: Key, value: Value | undefined) => boolean;
}

/**
 * Creates a signal that observes the given `source` and returns a new signal who only notifies
 * observers when entering or exiting a specified key.
 *
 * @see {@link https://github.com/solidjs/x-reactivity#createselector}
 */
export function createSelector<Source, Key = Source>(
  source: Accessor<Source>,
  options?: SelectorOptions<Key, Source>,
): SelectorSignal<Key> {
  let prevSource: Source | undefined,
    selectors = new Map<Key, Selector<Key>>(),
    equals =
      options?.equals ??
      (isEqual as (key: Key, value: Source | undefined) => boolean);

  const node = new Effect<Source | undefined>(
    undefined,
    () => {
      const newSource = source();

      for (const [key, selector] of selectors) {
        if (equals(key, newSource) !== equals(key, prevSource)) {
          for (let i = 0; i < selector._observers!.length; i++) {
            selector._observers![i]._notify(2 /* DIRTY */);
          }
        }
      }

      return (prevSource = newSource);
    },
    __DEV__ ? { name: options?.name } : undefined,
  );

  node.read();

  return function observeSelector(key: Key) {
    const observer = getObserver() as Computation;

    if (observer) {
      let node = selectors.get(key);
      if (!node) selectors.set(key, (node = new Selector(key, selectors)));
      node!.read();
      node!._refs += 1;
      observer.append(node!);
    }

    return equals(key, node._value);
  };
}

class Selector<Key> extends Computation<undefined> {
  _key: Key;
  _refs: number;
  _selectors: Map<Key, Selector<Key>> | null;
  constructor(key: Key, selectors: Map<Key, Selector<Key>>) {
    super(undefined, null);
    this._state = /** CLEAN */ 0;
    this._key = key;
    this._refs = 0;
    this._selectors = selectors;
    this._observers = [];
  }
  call() {
    this._refs -= 1;
    if (!this._refs) {
      this._selectors!.delete(this._key);
      this._selectors = null;
    }
  }
}
