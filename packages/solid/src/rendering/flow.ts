import { createMemo, sample, equalFn } from "../reactive/signal";
import { mapArray, indexArray } from "../reactive/array";
import { suspend } from "./resource";

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
  return suspend(indexArray<T, U>(() => props.each, props.children, fallback ? fallback : undefined));
}

export function Show(props: {
  when: unknown;
  fallback?: JSX.Element;
  children: JSX.Element | ((item: any) => JSX.Element);
}) {
  const useFallback = "fallback" in props,
    callFn = typeof Object.getOwnPropertyDescriptor(props, "children")!.value === "function",
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
    evalConditions = createMemo(
      () => {
        for (let i = 0; i < conditions.length; i++) {
          if (conditions[i].when) return i;
        }
        return -1;
      },
      undefined,
      equalFn
    );
  return suspend(() => {
    const index = evalConditions();
    return index < 0 ? useFallback && props.fallback : conditions[index].children;
  });
}

type MatchProps = { when: boolean; children: JSX.Element };
export function Match(props: MatchProps) {
  return (props as unknown) as JSX.Element;
}
