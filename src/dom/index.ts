export * from "./runtime";
import { createComponent, insert } from "./runtime";
import {
  createRoot,
  createMemo,
  SuspenseContext,
  onCleanup,
  sample,
  map,
  afterEffects,
  useContext
} from "../index";

const equalFn = <T>(a: T, b: T) => a === b;

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
  const mapped = createMemo(
    map<T, U>(
      props.children,
      "fallback" in props ? () => props.fallback : undefined
    )(() => props.each)
  );
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
  const useFallback = "fallback" in props,
    condition = createMemo(() => props.when, undefined, equalFn),
    mapped = createMemo(() =>
      condition() ? props.children : useFallback ? props.fallback : undefined
    );
  return props.transform ? props.transform(mapped, condition) : mapped;
}

export function Switch<T>(props: {
  fallback?: T;
  transform?: (mapped: () => T, source: () => number) => () => T;
  children: any;
}) {
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
    ),
    mapped = createMemo(() => {
      const index = evalConditions();
      return index < 0
        ? useFallback && props.fallback
        : conditions[index].children;
    });
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
        let dispose: () => void;
        const c = useContext(SuspenseContext),
          rendered = sample(() => props.children),
          marker = document.createTextNode(""),
          doc = document.implementation.createHTMLDocument();

        Object.defineProperty(doc.body, "host", {
          get() {
            return marker && marker.parentNode;
          }
        });

        return createMemo(() => {
          const value = c.suspended();
          if (c.initializing) c.initializing = false;
          dispose && dispose();
          if (!value) return [marker, rendered];
          afterEffects(() =>
            createRoot(disposer => {
              dispose = disposer;
              insert(doc.body, rendered)
            })
          );
          return [marker, props.fallback];
        });
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
