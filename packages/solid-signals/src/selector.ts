import {
  createComputation,
  getObserver,
  isEqual,
  notify,
  onCleanup,
  read,
} from "./core";
import type {
  Accessor,
  Computation,
  SelectorOptions,
  SelectorSignal,
} from "./types";

/**
 * Creates a signal that observes the given `source` and returns a new signal who only notifies
 * observers when entering or exiting a specified key.
 *
 * @see {@link https://github.com/solidjs/x-reactivity#createselector}
 */
export function createSelector<Source, Key = Source>(
  source: Accessor<Source>,
  options?: SelectorOptions<Key, Source>
): SelectorSignal<Key> {
  let prevSource: Source | undefined,
    selectors = new Map<Key, Selector>(),
    equals = options?.equals ?? isEqual;

  const node = createComputation<Source | undefined>(
    undefined,
    () => {
      const newSource = source();

      for (const [key, selector] of selectors) {
        if (equals(key, newSource) !== equals(key, prevSource)) {
          for (let i = 0; i < selector._observers!.length; i++) {
            notify(selector._observers![i], 2 /* DIRTY */);
          }
        }
      }

      return (prevSource = newSource);
    },
    __DEV__ ? { name: options?.name } : undefined
  );

  node._effect = true;
  read.call(node);

  return function observeSelector(key: Key) {
    const observer = getObserver();

    if (observer) {
      let node = selectors.get(key);
      if (!node) selectors.set(key, (node = new Selector(key, selectors)));
      read.call(node!);
      node!._refs += 1;
      onCleanup(node);
    }

    return equals(key, node._value);
  };
}

interface Selector<Key = any> extends Computation {
  _key: Key;
  _refs: number;
  _selectors: Map<Key, Selector> | null;
  call(): void;
}

function Selector<Key>(
  this: Selector<Key>,
  key: Key,
  selectors: Map<Key, Selector>
) {
  this._state = /** CLEAN */ 0;
  this._key = key;
  this._refs = 0;
  this._selectors = selectors;
  this._observers = [];
}

const SelectorProto = Selector.prototype;
SelectorProto.call = function (this: Selector) {
  this._refs -= 1;
  if (!this._refs) {
    this._selectors!.delete(this._key);
    this._selectors = null;
  }
};
