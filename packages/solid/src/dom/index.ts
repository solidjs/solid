export * from "dom-expressions/src/runtime";
export * from "./Suspense";
import { insert } from "dom-expressions/src/runtime";
import {
  createMemo,
  onCleanup,
  sample,
  mapArray,
  suspend,
  equalFn
} from "../index.js";

export function For<T, U>(props: { each: T[]; fallback?: any; children: (item: T) => U }) {
  const fallback = "fallback" in props && { fallback: () => props.fallback };
  return suspend(
    createMemo(mapArray<T, U>(() => props.each, props.children, fallback ? fallback : undefined))
  );
}

export function Show<T>(props: { when: boolean; fallback?: T; children: T }) {
  const useFallback = "fallback" in props,
    condition = createMemo(() => !!props.when, undefined, equalFn);
  return suspend(
    createMemo(() =>
      condition()
        ? sample(() => props.children)
        : useFallback
        ? sample(() => props.fallback)
        : undefined
    )
  );
}

export function Switch<T>(props: { fallback?: T; children: any }) {
  let conditions = props.children;
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
  return suspend(
    createMemo(() => {
      const index = evalConditions();
      return sample(() => (index < 0 ? useFallback && props.fallback : conditions[index].children));
    })
  );
}

type MatchProps = { when: boolean; children: any };
export function Match(props: MatchProps) {
  return props;
}

export function Portal(props: {
  mount?: Node;
  useShadow?: boolean;
  ref?: (e: HTMLDivElement) => void;
  children: any;
}) {
  const { useShadow } = props,
    container = document.createElement("div"),
    marker = document.createTextNode(""),
    mount = props.mount || document.body,
    renderRoot =
      useShadow && container.attachShadow ? container.attachShadow({ mode: "open" }) : container;

  Object.defineProperty(container, "host", {
    get() {
      return marker.parentNode;
    }
  });
  insert(
    renderRoot,
    sample(() => props.children)
  );
  mount.appendChild(container);
  props.ref && props.ref(container);
  onCleanup(() => mount.removeChild(container));
  return marker;
}
