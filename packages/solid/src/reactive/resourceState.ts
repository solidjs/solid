import { batch, createSignal, Listener, createResource, hashValue, registerGraph } from "./signal";

import {
  updatePath,
  wrap,
  unwrap,
  isWrappable,
  getDataNodes,
  $RAW,
  $NODE,
  $PROXY,
  StateNode,
  SetStateFunction,
  State,
  setProperty,
  proxyDescriptor
} from "./state";

function createResourceNode(v: any, name: string) {
  // maintain setState capability by using normal data node as well
  const node = "_SOLID_DEV_" ? createSignal(undefined, false, { internal: true }) : createSignal(),
    [r, load] = createResource(v, { name });
  return [() => (r(), node[0]()), node[1], load, () => r.loading];
}

export interface LoadStateFunction<T> {
  (
    v: { [P in keyof T]?: () => Promise<T[P]> | T[P] },
    reconcilerFn?: (v: Partial<T>) => (state: State<T>) => void
  ): void;
}

export function createResourceState<T extends StateNode>(
  state: T | State<T>,
  options: { name?: string } = {}
): [
  State<T & { loading: { [P in keyof T]: boolean } }>,
  LoadStateFunction<T>,
  SetStateFunction<T>
] {
  const loadingTraps: ProxyHandler<any> = {
    get(nodes, property: string | number) {
      const node =
        nodes[property] ||
        (nodes[property] = createResourceNode(undefined, name && `${options.name}:${property}`));
      return node[3]();
    },

    set() {
      return true;
    },

    deleteProperty() {
      return true;
    }
  };

  const resourceTraps: ProxyHandler<StateNode> = {
    get(target, property, receiver) {
      if (property === $RAW) return target;
      if (property === $PROXY) return receiver;
      if (property === "loading") return new Proxy(getDataNodes(target), loadingTraps);
      const value = target[property as string | number];
      if (property === $NODE || property === "__proto__") return value;

      const wrappable = isWrappable(value);
      if (Listener && (typeof value !== "function" || target.hasOwnProperty(property))) {
        let nodes, node;
        if (wrappable && (nodes = getDataNodes(value))) {
          node =
            nodes._ ||
            (nodes._ = "_SOLID_DEV_"
              ? createSignal(undefined, false, { internal: true })
              : createSignal());
          node[0]();
        }
        nodes = getDataNodes(target);
        node =
          nodes[property] ||
          (nodes[property] = createResourceNode(value, `${options.name}:${property as string}`));
        node[0]();
      }
      return wrappable
        ? wrap(value, "_SOLID_DEV_" && options.name && `${options.name}:${property as string}`)
        : value;
    },

    set() {
      return true;
    },

    deleteProperty() {
      return true;
    },
    getOwnPropertyDescriptor: proxyDescriptor
  };

  const unwrappedState = unwrap<T>(state || {}, true),
    wrappedState = wrap<T & { loading: { [P in keyof T]: boolean } }>(
      unwrappedState as any,
      "_SOLID_DEV_" && ((options && options.name) || hashValue(unwrappedState)),
      true,
      resourceTraps
    );
  if ("_SOLID_DEV_") {
    const name = (options && options.name) || hashValue(unwrappedState);
    registerGraph(name, { value: unwrappedState });
  }
  function setState(...args: any[]): void {
    batch(() => updatePath(unwrappedState, args));
  }
  function loadState(
    v: { [P in keyof T]: () => Promise<T[P]> | T[P] },
    r?: (v: Partial<T>) => (state: State<T>) => void
  ) {
    const nodes = getDataNodes(unwrappedState),
      keys = Object.keys(v);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i],
        node =
          nodes[k] || (nodes[k] = createResourceNode(unwrappedState[k], `${options.name}:${k}`)),
        resolver = (v?: T[keyof T]) => (
          r
            ? setState(k, r(v as Partial<T>))
            : setProperty(unwrappedState, k as string | number, v),
          v
        ),
        p = node[2](v[k]);
      typeof p === "object" && "then" in p ? p.then(resolver) : resolver(p);
    }
  }

  return [wrappedState, loadState as LoadStateFunction<T>, setState];
}
