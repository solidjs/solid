import {
  createState,
  createEffect,
  createMemo,
  createComputed,
  createSignal,
  onCleanup,
  createRoot
} from "solid-js";

import {
  useMemo as rMemo,
  useState as rState,
  useEffect as rEffect,
  useRef as rRef,
  useCallback as rCallback,
  memo
} from "react";

export { reconcile, untrack, batch } from "solid-js";

let inSolidEffect = false;
function trackNesting(args) {
  const fn = args[0];
  return [
    function() {
      const outside = inSolidEffect;
      inSolidEffect = true;
      const ret = fn.call(this, arguments);
      inSolidEffect = outside;
      return ret;
    },
    ...args.slice(1)
  ];
}

function useForceUpdate() {
  const [, setTick] = rState(0);
  return rCallback(() => setTick(t => t + 1), []);
}

export function useObserver(fn) {
  const forceUpdate = useForceUpdate(),
    [tracking, trigger] = useSignal({}),
    run = rRef(),
    dispose = rRef(),
    results = rRef();
  run.current = fn;
  rEffect(() => dispose.current, []);
  if (!dispose.current) {
    createRoot(disposer => {
      dispose.current = disposer;
      createEffect(() => {
        const v = tracking();
        if (!("top" in v)) return;
        else if (v.top) results.current = run.current();
        else forceUpdate();
        v.top = false;
      });
    });
  }
  trigger({ top: true });
  return results.current;
}

export function withSolid(ComponentType) {
  return memo((p, r) => useObserver(ComponentType(p, r)));
}

export function useState(v) {
  if (inSolidEffect) return createState(v);
  return rMemo(() => createState(v), []);
}

export function useSignal(v) {
  if (inSolidEffect) return createSignal(v);
  return rMemo(() => createSignal(v), []);
}

export function useEffect(...args) {
  if (inSolidEffect) return createEffect(...args);
  const dispose = rRef();
  rEffect(() => dispose.current, []);
  if (!dispose.current) {
    createRoot(disposer => {
      dispose.current = disposer;
      createEffect(...trackNesting(args));
    });
  }
}

export function useComputed(...args) {
  if (inSolidEffect) return createComputed(...args);
  const dispose = rRef();
  rEffect(() => dispose.current, []);
  if (!dispose.current) {
    createRoot(disposer => {
      dispose.current = disposer;
      createComputed(...trackNesting(args));
    });
  }
}

export function useMemo(...args) {
  if (inSolidEffect) return createMemo(...args);
  let dispose;
  rEffect(() => dispose, []);
  return rMemo(
    () =>
      createRoot(disposer => {
        dispose = disposer;
        return createMemo(...trackNesting(args));
      }),
    []
  );
}

export function useCleanup(fn) {
  inSolidEffect ? onCleanup(fn) : rEffect(() => fn, []);
}
