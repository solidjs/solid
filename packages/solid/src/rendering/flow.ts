import { createMemo, sample, createSignal, onError } from "../reactive/signal";
import { mapArray, indexArray } from "../reactive/array";
import { suspend } from "./resource";
import { Component, split } from "./component";

function simpleMap(
  props: { each: any[]; children: Function; fallback?: JSX.Element },
  wrap: (fn: Function, item: any, i: number) => JSX.Element
): JSX.Element {
  const list = props.each || [],
    len = list.length,
    fn = props.children;
  if (len) {
    const mapped = new Array(len);
    for (let i = 0; i < len; i++) mapped[i] = wrap(fn, list[i], i);
    return mapped;
  }
  return props.fallback;
}

export function For<T, U extends JSX.Element>(props: {
  each: T[];
  fallback?: JSX.Element;
  children: (item: T, index: () => number) => U;
}) {
  const fallback = "fallback" in props && { fallback: () => props.fallback },
    nonDynamicDesc = Object.getOwnPropertyDescriptor(props, "each")!.value;
  return nonDynamicDesc && typeof nonDynamicDesc !== "function"
    ? simpleMap(props, (fn, item, i) => fn(item, () => i))
    : suspend(mapArray<T, U>(() => props.each, props.children, fallback ? fallback : undefined));
}

// non-keyed
export function Index<T, U extends JSX.Element>(props: {
  each: T[];
  fallback?: JSX.Element;
  children: (item: () => T, index: number) => U;
}) {
  const fallback = "fallback" in props && { fallback: () => props.fallback },
    nonDynamicDesc = Object.getOwnPropertyDescriptor(props, "each")!.value;
  return nonDynamicDesc && typeof nonDynamicDesc !== "function"
    ? simpleMap(props, (fn, item, i) => fn(() => item, i))
    : suspend(indexArray<T, U>(() => props.each, props.children, fallback ? fallback : undefined));
}

export function Show<T>(props: {
  when: T | false;
  fallback?: JSX.Element;
  children: JSX.Element | ((item: T) => JSX.Element);
}) {
  const childDesc = Object.getOwnPropertyDescriptor(props, "children")!.value,
    callFn = typeof childDesc === "function" && childDesc.length,
    condition = createMemo<T | boolean>(
      callFn ? () => props.when : () => !!props.when,
      undefined,
      true
    );
  return suspend(() => {
    const c = condition();
    return c
      ? callFn
        ? sample(() => (props.children as (item: T) => JSX.Element)(c as T))
        : props.children
      : props.fallback;
  }) as () => JSX.Element;
}

export function Switch(props: { fallback?: JSX.Element; children: JSX.Element }) {
  let conditions = (props.children as unknown) as (MatchProps<unknown> & { keyed: boolean })[];
  Array.isArray(conditions) || (conditions = [conditions]);
  const evalConditions = createMemo<[number, unknown?]>(
    () => {
      for (let i = 0; i < conditions.length; i++) {
        const c = conditions[i].when;
        if (c) return [i, conditions[i].keyed ? c : !!c];
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

type MatchProps<T> = {
  when: T | false;
  children: JSX.Element | ((item: T) => JSX.Element);
};
export function Match<T>(props: MatchProps<T>) {
  const childDesc = Object.getOwnPropertyDescriptor(props, "children")!.value;
  (props as MatchProps<T> & { keyed: boolean }).keyed =
    typeof childDesc === "function" && !!childDesc.length;
  return (props as unknown) as JSX.Element;
}

export function ErrorBoundary(props: {
  fallback: JSX.Element | ((err: any) => JSX.Element);
  children: JSX.Element;
}) {
  const [errored, setErrored] = createSignal(),
    fallbackDesc = Object.getOwnPropertyDescriptor(props, "fallback")!.value,
    callFn = typeof fallbackDesc === "function" && !!fallbackDesc.length;
  onError(setErrored);
  let e: any;
  return createMemo(() =>
    (e = errored()) != null
      ? callFn
        ? sample(() => (props.fallback as (err: any) => JSX.Element)(e))
        : props.fallback
      : props.children
  ) as () => JSX.Element;
}

// use the version from solid-js/dom to support intrinsic elements writing for future considerations
/* istanbul ignore next */
export function Dynamic<T>(props: T & { component?: Component<T> }) {
  const [p, others] = split(props, ["component"]);
  return suspend(() => {
    const comp = p.component;
    return comp && sample(() => comp(others as any));
  });
}
