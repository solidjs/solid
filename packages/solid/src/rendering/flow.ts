import { createMemo, sample } from "../reactive/signal";
import { mapArray, indexArray } from "../reactive/array";
import { suspend } from "./resource";
import { Component, splitProps } from "./component";

export function For<T, U extends JSX.Element>(props: {
  each: T[];
  fallback?: JSX.Element;
  children: (item: T, index: () => number) => U;
}) {
  const fallback = "fallback" in props && { fallback: () => props.fallback };
  return suspend(mapArray<T, U>(() => props.each, props.children, fallback ? fallback : undefined));
}

// non-keyed
export function Index<T, U extends JSX.Element>(props: {
  each: T[];
  fallback?: JSX.Element;
  children: (item: () => T, index: number) => U;
}) {
  const fallback = "fallback" in props && { fallback: () => props.fallback };
  return suspend(
    indexArray<T, U>(() => props.each, props.children, fallback ? fallback : undefined)
  );
}

export function Show<T>(props: {
  when: T | false;
  fallback?: JSX.Element;
  children: JSX.Element | ((item: T) => JSX.Element);
}) {
  const childDesc = Object.getOwnPropertyDescriptor(props, "children")!.value,
    callFn = typeof childDesc === "function" && childDesc.length,
    condition = createMemo(() => props.when, undefined, true);
  return suspend(() => {
    const c = condition();
    return c
      ? callFn
        ? sample(() => (props.children as (item: T) => JSX.Element)(c))
        : props.children
      : props.fallback;
  }) as () => JSX.Element;
}

export function Switch(props: { fallback?: JSX.Element; children: JSX.Element }) {
  let conditions = (props.children as unknown) as MatchProps<unknown>[];
  Array.isArray(conditions) || (conditions = [conditions]);
  const evalConditions = createMemo<[number, unknown?]>(
      () => {
        for (let i = 0; i < conditions.length; i++) {
          const c = conditions[i].when;
          if (c) return [i, c];
        }
        return [-1];
      },
      undefined,
      (a, b) => a && a[0] === b[0] && a[1] === b[1]
    );
  return suspend(() => {
    const [index, when] = evalConditions();
    if (index < 0) return props.fallback;
    const c = conditions[index].children;
    return typeof c === "function" && c.length ? sample(() => c(when)) : (c as JSX.Element);
  });
}

type MatchProps<T> = { when: T | null | undefined | false; children: JSX.Element | ((item: T) => JSX.Element) };
export function Match<T>(props: MatchProps<T>) {
  return (props as unknown) as JSX.Element;
}

// use the version from solid-js/dom to support intrinsic elements writing for future considerations
/* istanbul ignore next */
export function Dynamic<T>(props: T & { component?: Component<T> }) {
  const [p, others] = splitProps(props, ["component"]);
  return () => {
    const comp = p.component;
    return comp && sample(() => comp(others as any));
  };
}
