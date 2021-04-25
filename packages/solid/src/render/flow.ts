import { createMemo, untrack, createSignal, onError, children } from "../reactive/signal";
import { mapArray, indexArray } from "../reactive/array";
import type { JSX } from "../jsx";

export function For<T, U extends JSX.Element>(props: {
  each: readonly T[];
  fallback?: JSX.Element;
  children: (item: T, index: () => number) => U;
}) {
  const fallback = "fallback" in props && { fallback: () => props.fallback };
  return createMemo(
    mapArray<T, U>(() => props.each, props.children, fallback ? fallback : undefined),
    undefined,
    { equals: false }
  );
}

// non-keyed
export function Index<T, U extends JSX.Element>(props: {
  each: readonly T[];
  fallback?: JSX.Element;
  children: (item: () => T, index: number) => U;
}) {
  const fallback = "fallback" in props && { fallback: () => props.fallback };
  return createMemo(
    indexArray<T, U>(() => props.each, props.children, fallback ? fallback : undefined),
    undefined,
    { equals: false }
  );
}

export function Show<T>(props: {
  when: T | undefined | null | false;
  fallback?: JSX.Element;
  children: JSX.Element | ((item: T) => JSX.Element);
}) {
  let strictEqual = false;
  const condition = createMemo<T | undefined | null | boolean>(() => props.when, undefined, {
    equals: (a, b) => (strictEqual ? a === b : !a === !b)
  });
  return createMemo(() => {
    const c = condition();
    if (c) {
      const child = props.children;
      return (strictEqual = typeof child === "function" && child.length > 0)
        ? untrack(() => (child as any)(c as T))
        : child;
    }
    return props.fallback;
  }) as () => JSX.Element;
}

export function Switch(props: { fallback?: JSX.Element; children: JSX.Element }) {
  let strictEqual = false;
  const conditions = children(() => props.children) as () => MatchProps<unknown>[],
    evalConditions = createMemo<[number, unknown?, MatchProps<unknown>?]>(
      () => {
        let conds = conditions();
        if (!Array.isArray(conds)) conds = [conds];
        for (let i = 0; i < conds.length; i++) {
          const c = conds[i].when;
          if (c) return [i, c, conds[i]];
        }
        return [-1];
      },
      undefined,
      {
        equals: (a: [number, unknown?, unknown?], b: [number, unknown?, unknown?]) =>
          a && a[0] === b[0] && (strictEqual ? a[1] === b[1] : !a[1] === !b[1]) && a[2] === b[2]
      }
    );
  return createMemo(() => {
    const [index, when, cond] = evalConditions();
    if (index < 0) return props.fallback;
    const c = cond!.children;
    return (strictEqual = typeof c === "function" && c.length > 0)
      ? untrack(() => (c as any)(when))
      : c;
  });
}

type MatchProps<T> = {
  when: T | undefined | null | false;
  children: JSX.Element | ((item: T) => JSX.Element);
};
export function Match<T>(props: MatchProps<T>) {
  return (props as unknown) as JSX.Element;
}

export function ErrorBoundary(props: {
  fallback: JSX.Element | ((err: any, reset: () => void) => JSX.Element);
  children: JSX.Element;
}) {
  const [errored, setErrored] = createSignal<any>();
  onError(setErrored);
  let e: any;
  return createMemo(() => {
    if ((e = errored()) != null) {
      const f = props.fallback;
      return typeof f === "function" && f.length ? untrack(() => f(e, () => setErrored(null))) : f;
    }
    return props.children;
  }) as () => JSX.Element;
}
