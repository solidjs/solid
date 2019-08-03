export * from "./runtime";
import { createComponent, insert } from "./runtime";
import {
  createRoot,
  SuspenseContext,
  onCleanup,
  sample,
  map,
  useContext
} from "../index";

export function render(code: () => any, element: Node): () => void {
  let disposer: () => void;
  createRoot(dispose => {
    disposer = dispose;
    insert(element, code());
  });
  return disposer!;
}

export function For<T, U>(props: {
  each: T[];
  fallback?: any;
  transform?: (mapped: () => U[], source: () => T[]) => () => U[];
  children: (item: T, index: number) => U;
}) {
  const mapped = map<T, U>(
    props.children,
    "fallback" in props ? () => props.fallback : undefined
  )(() => props.each);
  return props.transform ? props.transform(mapped, () => props.each) : mapped;
}

export function Show<T>(props: {
  when: boolean;
  fallback?: T;
  transform?: (
    mapped: () => T | undefined,
    source: () => boolean
  ) => () => T | undefined;
  children: T;
}) {
  let dispose: () => void, cached: T | undefined, prev: Boolean;
  const useFallback = "fallback" in props,
    mapped = () => {
      const v = props.when;
      if (v === prev) return cached;
      prev = v;
      dispose && dispose();
      return createRoot(disposer => {
        dispose = disposer;
        return (cached = v
          ? props.children
          : useFallback
          ? props.fallback
          : undefined);
      });
    };
  return props.transform ? props.transform(mapped, () => props.when) : mapped;
}

export function Switch<T>(props: {
  fallback?: T;
  transform?: (mapped: () => T, source: () => number) => () => T;
  children: any;
}) {
  let conditions = props.children,
    dispose: () => void,
    cached: T | undefined,
    prev: number;
  Array.isArray(conditions) || (conditions = [conditions]);
  const useFallback = "fallback" in props,
    evalConditions = () => {
      for (let i = 0; i < conditions.length; i++) {
        if (conditions[i].when) return i;
      }
      return -1;
    },
    mapped = () => {
      const index = evalConditions();
      if (index === prev) return cached;
      prev = index;
      dispose && dispose();
      return createRoot(disposer => {
        dispose = disposer;
        return (cached =
          index < 0
            ? useFallback && props.fallback
            : conditions[index].children);
      });
    };
  return props.transform ? props.transform(mapped, evalConditions) : mapped;
}

type MatchProps = { when: boolean; children: any };
export function Match(props: MatchProps) {
  return props;
}

export function Suspense(props: {
  delayMs?: number;
  fallback: any;
  children: any;
}) {
  return createComponent(
    SuspenseContext.Provider,
    {
      value: props.delayMs,
      children: () => {
        const c = useContext(SuspenseContext),
          rendered = sample(() => props.children),
          marker = document.createTextNode(""),
          doc = document.implementation.createHTMLDocument();

        Object.defineProperty(doc.body, "host", {
          get() {
            return marker && marker.parentNode;
          }
        });

        return () => {
          const value = c.suspended();
          if (c.initializing) c.initializing = false;
          if (!value) return [marker, rendered];
          setTimeout(insert(doc.body, rendered));
          return [marker, props.fallback];
        };
      }
    },
    ["children"]
  );
}

export function Portal(props: {
  mount?: Node;
  useShadow?: boolean;
  children: any;
}) {
  const { useShadow } = props,
    container = document.createElement("div"),
    marker = document.createTextNode(""),
    mount = props.mount || document.body,
    renderRoot =
      useShadow && container.attachShadow
        ? container.attachShadow({ mode: "open" })
        : container;

  Object.defineProperty(container, "host", {
    get() {
      return marker.parentNode;
    }
  });
  insert(renderRoot, sample(() => props.children));
  mount.appendChild(container);
  onCleanup(() => mount.removeChild(container));
  return marker;
}
