import { makeDataNode, on, makeComputationNode } from '@ryansolid/s-js';
export { comp as createMemo } from '@ryansolid/s-js';

export function createSignal<T>(value?: T, comparator?: (v?: T, p?: T) => boolean): [() => T, (v: T) => void] {
  const d = makeDataNode(value);
  let setter;
  if (comparator) {
    let age = -1;
    setter = (v: T) => {
      if (!comparator(value, v)) {
        const time = d.clock().time();
        if (time === age) {
          throw new Error(`Conflicting value update: ${v} is not the same as ${value}`);
        }
        age = time;
        value = v;
        d.next(v);
      }
    };
  } else setter = d.next.bind(d);
  return [d.current.bind(d), setter];
}

export function createEffect<T>(fn: (v?: T) => T, seed?: T) {
  makeComputationNode(fn, seed, false, false)
}

// explicit dependencies and defered initial execution
export function createDependentEffect<T>(fn: (v?: T) => T, deps: () => any | (() => any)[], defer?: boolean) {
  on(deps, fn, undefined, defer);
}
