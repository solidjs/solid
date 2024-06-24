import { STATE_DIRTY } from './constants';
import { Computation, getObserver, isEqual } from './core';
import { Effect } from './effect';
import { onCleanup } from './owner';
import type { Accessor } from './signals';

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
    subs = new Map<Key, Set<Computation<any>>>(),
    equals =
      options?.equals ??
      (isEqual as (key: Key, value: Source | undefined) => boolean);

  const node = new Effect<Source | undefined>(
    undefined,
    () => {
      const newSource = source();

      for (const [key, val] of subs) {
        if (equals(key, newSource) !== equals(key, prevSource)) {
          for (const c of val.values()) {
            c._notify(STATE_DIRTY);
          }
        }
      }

      return (prevSource = newSource);
    },
    () => {}, //TODO: make sure this makes sense
    __DEV__ ? { name: options?.name } : undefined,
  );

  return function observeSelector(key: Key) {
    const observer = getObserver() as Computation;

    if (observer) {
      let l: Set<Computation<any>> | undefined;
      if ((l = subs.get(key))) l.add(observer);
      else subs.set(key, (l = new Set([observer])));
      onCleanup(() => {
        l!.delete(observer!);
        !l!.size && subs.delete(key);
      });
    }
    return equals(key, node.read());
  };
}
