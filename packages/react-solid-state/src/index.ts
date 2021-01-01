import {memo, PropsWithChildren, ReactElement, useCallback as rCallback, useEffect as rEffect, useMemo as rMemo, useRef as rRef, useState as rState,} from 'react';
import {createComputed, CreateComputed, createEffect, CreateEffect, createMemo, CreateMemo, createMutable, createRoot, createSignal, createState, onCleanup, State} from 'solid-js';

export {batch, reconcile, untrack} from 'solid-js';

let inSolidEffect = false;
function trackNesting<T extends any[]>(args: T): T {
  const fn = args[0] as (...args: any[]) => void;
  return [
    function(...args: any[]) {
      const outside = inSolidEffect;
      inSolidEffect = true;
      const ret = fn(...args);
      inSolidEffect = outside;
      return ret;
    },
    ...args.slice(1)
  ] as T;
}

function useForceUpdate() {
  const [, setTick] = rState(0);
  return rCallback(() => setTick(t => t + 1), []);
}

export function useObserver(fn: ReactElement|(() => JSX.Element)) {
  const forceUpdate = useForceUpdate(), [tracking, trigger] = useSignal({}),
        run = rRef<ReactElement|(() => JSX.Element)>(),
        dispose = rRef<() => void>(), results = rRef<ReactElement|null>();
  run.current = fn;
  rEffect(() => dispose.current, []);
  if (!dispose.current) {
    createRoot((disposer) => {
      dispose.current = disposer;
      createComputed(() => {
        const v = tracking() as {top?: boolean};
        if (!('top' in v)) return;
        else if (v.top && run.current)
          results.current =
              (run.current as {} as () => typeof results.current)();
        else forceUpdate();
        v.top = false;
      });
    });
  }
  trigger({top: true});
  return results.current;
}

export function withSolid<P extends object>(
    ComponentType: (props: PropsWithChildren<P>, r: any) => () => JSX.Element) {
  return memo<P>((p, r) => {
    const component = ComponentType(p, r);
    return component && useObserver(component) || null;
  });
}

export function useState<T>(state: T|State<T>, options?: {name?: string}) {
  if (inSolidEffect) return createState<T>(state, options);
  return rMemo(() => createState<T>(state, options), []);
}

export function useMutable<T>(state: T|State<T>, options?: {name?: string}) {
  if (inSolidEffect) return createMutable<T>(state, options);
  return rMemo(() => createMutable<T>(state, options), []);
}

export function useSignal<T>(
    value: T, areEqual?: boolean|((prev: T, next: T) => boolean),
    options?: {name?: string; internal?: boolean;}) {
  if (inSolidEffect) return createSignal<T>(value, areEqual, options);
  return rMemo(() => createSignal<T>(value, areEqual, options), []);
}

export function useEffect<T>(...args: Parameters<CreateEffect<T>>) {
  if (inSolidEffect) return createEffect<T>(...args);
  const dispose = rRef<() => void>();
  rEffect(() => dispose.current, []);
  if (!dispose.current) {
    createRoot(disposer => {
      dispose.current = disposer;
      createEffect<T>(...trackNesting(args));
    });
  }
}

export function useComputed<T>(...args: Parameters<CreateComputed<T>>) {
  if (inSolidEffect) return createComputed<T>(...args);
  const dispose = rRef<() => void>();
  rEffect(() => dispose.current, []);
  if (!dispose.current) {
    createRoot(disposer => {
      dispose.current = disposer;
      createComputed(...trackNesting(args));
    });
  }
}


export function useMemo<T>(...args: Parameters<CreateMemo<T>>) {
  if (inSolidEffect) return createMemo<T>(...args);
  let dispose: () => void;
  rEffect(() => dispose, []);
  return rMemo(
      () => createRoot(disposer => {
        dispose = disposer;
        return createMemo(...trackNesting(args));
      }),
      []);
}

export function useCleanup(fn: Parameters<typeof onCleanup>[0]) {
  inSolidEffect ? onCleanup(fn) : rEffect(() => fn, []);
}
