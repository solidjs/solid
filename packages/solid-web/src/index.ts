import {
  getNextElement,
  insert,
  spread,
  SVGElements,
  MathMLElements,
  Namespaces,
  hydrate as hydrateCore
} from "./client.js";
import {
  createMemo,
  createRoot,
  untrack,
  omit,
  JSX,
  sharedConfig,
  enableHydration,
  enforceLoadingBoundary,
  flatten,
  flush,
  $DEVCOMP,
  ComponentProps,
  ValidComponent,
  createRenderEffect
} from "solid-js";

export * from "./client.js";
export * from "./server-mock.js";
export {
  For,
  Show,
  Switch,
  Match,
  Errored,
  Loading,
  Repeat,
  Reveal,
  NoHydration,
  Hydration,
  merge as mergeProps
} from "solid-js";

export const isServer: boolean = false;
export const isDev: boolean = "_SOLID_DEV_" as unknown as boolean;

type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;

export type DynamicProps<T extends ValidComponent, P = ComponentProps<T>> = {
  [K in keyof P]: P[K];
} & {
  component: T | undefined;
};

/**
 * Renders a component tree into a DOM element and returns a dispose function.
 *
 * The top-level insert runs with `schedule: true` so its initial DOM attach
 * goes through the effect queue rather than executing inline. This lets the
 * mount participate in transitions: if an uncaught async read surfaces during
 * the initial render (no `Loading` ancestor absorbs it), the mount is held by
 * the transition and attaches atomically once all pending settles. On the
 * no-async happy path the tail `flush()` drains the queued callback so the
 * attach is synchronous by the time `render()` returns.
 */
export function render(
  code: () => JSX.Element,
  element: MountableElement,
  init?: unknown,
  options: { renderId?: string } = {}
): () => void {
  // @ts-ignore — replaced at build time
  if ("_DX_DEV_" && !element) {
    throw new Error(
      "The `element` passed to `render(..., element)` doesn't exist. Make sure `element` exists in the document."
    );
  }
  const renderRoot =
    (element as Element).localName === "template"
      ? (element as HTMLTemplateElement).content
      : element;
  let disposer!: () => void;
  createRoot(
    dispose => {
      disposer = dispose;
      if (element === document) {
        (flatten as (v: unknown) => unknown)(code);
        return;
      }
      const marker = (renderRoot as Node).firstChild ? null : undefined;
      // Narrow the enforcement window to the component body evaluation and
      // the top-level insert's initial recompute; subsequent updates run under
      // their own transitions and should not trigger the warn. The bails
      // originate inside insert()'s compute (normalize/flatten reads memos),
      // so enforcement must stay on through the insert() call.
      // @ts-ignore — replaced at build time
      if ("_DX_DEV_") enforceLoadingBoundary(true);
      try {
        // Pass tree as an accessor so insert() always takes the effect path
        // (otherwise a concrete Node would short-circuit to the synchronous
        // insertExpression branch and skip the `schedule` option).
        const tree = code();
        (
          insert as unknown as (
            parent: MountableElement,
            accessor: unknown,
            marker: Node | null | undefined,
            initial: unknown,
            options?: { schedule?: boolean }
          ) => void
        )(element, () => tree, marker, init, { schedule: true });
      } finally {
        // @ts-ignore — replaced at build time
        if ("_DX_DEV_") enforceLoadingBoundary(false);
      }
    },
    { id: options.renderId } as any
  );
  flush();
  return () => {
    disposer();
    (renderRoot as Element).textContent = "";
  };
}

export const hydrate: typeof hydrateCore = (...args) => {
  enableHydration();
  return hydrateCore(...args);
};

/**
 * Renders components somewhere else in the DOM
 *
 * Useful for inserting modals and tooltips outside of an cropping layout. If no mount point is given, the portal is inserted in document.body; it is wrapped in a `<div>` unless the target is document.head or `isSVG` is true. setting `useShadow` to true places the element in a shadow root to isolate styles.
 *
 * @description https://docs.solidjs.com/reference/components/portal
 */
export function Portal<T extends boolean = false, S extends boolean = false>(props: {
  mount?: Element;
  children: JSX.Element;
}) {
  const treeMarker = document.createTextNode(""),
    startMarker = document.createTextNode(""),
    endMarker = document.createTextNode(""),
    mount = () => createElementProxy(props.mount || document.body, treeMarker);
  let content = createMemo(() => [startMarker, props.children]);

  createRenderEffect<[Element, JSX.Element]>(
    () => [mount(), content()],
    ([m, c]) => {
      m.appendChild(endMarker);
      insert(m, c, endMarker);
      return () => {
        let c: Node | null = startMarker;
        while (c && c !== endMarker) {
          const n: Node | null = c.nextSibling;
          m.removeChild(c);
          c = n;
        }
      };
    }
  );
  return treeMarker;
}

/**
 * Renders an arbitrary component or element with the given props
 *
 * This is a lower level version of the `Dynamic` component, useful for
 * performance optimizations in libraries. Do not use this unless you know
 * what you are doing.
 * ```typescript
 * const element = () => multiline() ? 'textarea' : 'input';
 * createDynamic(element, { value: value() });
 * ```
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export function createDynamic<T extends ValidComponent>(
  component: () => T | undefined,
  props: ComponentProps<T>
): JSX.Element {
  const cached = createMemo<Function | string | undefined>(component);
  return createMemo(() => {
    const component = cached();
    switch (typeof component) {
      case "function":
        if (isDev) Object.assign(component, { [$DEVCOMP]: true });
        return untrack(() => component(props));

      case "string":
        const el = sharedConfig.hydrating
          ? getNextElement()
          : createElement(
              component,
              untrack(() => props.is)
            );
        spread(el, props);
        return el;

      default:
        break;
    }
  }) as unknown as JSX.Element;
}

/**
 * Renders an arbitrary custom or native component and passes the other props
 * ```typescript
 * <Dynamic component={multiline() ? 'textarea' : 'input'} value={value()} />
 * ```
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export function Dynamic<T extends ValidComponent>(props: DynamicProps<T>): JSX.Element {
  const others = omit(props, "component");
  return createDynamic(() => props.component, others as ComponentProps<T>);
}

function createElement(tagName: string, is = undefined): HTMLElement | SVGElement | MathMLElement {
  return (
    SVGElements.has(tagName)
      ? document.createElementNS(Namespaces.svg, tagName)
      : MathMLElements.has(tagName)
        ? document.createElementNS(Namespaces.mathml, tagName)
        : document.createElement(tagName, { is })
  ) as HTMLElement | SVGElement | MathMLElement;
}

function createElementProxy(el: Element, marker: Text) {
  return new Proxy(el, {
    get(target, prop) {
      if (prop === "appendChild" || prop === "insertBefore") {
        return (...args: [Node]) => {
          Object.defineProperty(args[0], "_$host", {
            get: () => marker.parentNode,
            configurable: true
          });
          (target[prop] as any)(...args);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
