import { createMemo, sample, equalFn } from "../reactive/signal";
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

export function Show(props: {
  when: unknown;
  fallback?: JSX.Element;
  children: JSX.Element | ((item: any) => JSX.Element);
}) {
  const useFallback = "fallback" in props,
    childDesc = Object.getOwnPropertyDescriptor(props, "children")!.value,
    callFn = typeof childDesc === "function" && childDesc.length,
    condition = createMemo(() => props.when, undefined, equalFn);
  return suspend(() => {
    const c = condition();
    return c
      ? callFn
        ? sample(() => (props.children as (item: any) => JSX.Element)(c))
        : props.children
      : useFallback
      ? props.fallback
      : undefined;
  }) as () => JSX.Element;
}

export function Switch(props: { fallback?: JSX.Element; children: JSX.Element }) {
  let conditions = (props.children as unknown) as MatchProps[];
  Array.isArray(conditions) || (conditions = [conditions]);
  const useFallback = "fallback" in props,
    evalConditions = createMemo<[number, any?]>(
      () => {
        for (let i = 0; i < conditions.length; i++) {
          const c = conditions[i].when;
          if (c) return [i, c];
        }
        return [-1];
      },
      undefined,
      equalFn
    );
  return suspend(() => {
    const [index, when] = evalConditions();
    if (index < 0) return useFallback && props.fallback;
    const c = conditions[index].children;
    return typeof c === "function" && c.length ? c(when) : (c as JSX.Element);
  });
}

type MatchProps = { when: unknown; children: JSX.Element | ((item: any) => JSX.Element) };
export function Match(props: MatchProps) {
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
