import {
  batch,
  createSignal,
  getListener,
  createResource
} from "./signal";

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
  setProperty
} from "./state";

function createResourceNode(v: any, name: string) {
  // maintain setState capability by using normal data node as well
  const node = createSignal(),
    [r, load] = createResource(v, { name });
  return [() => (r(), node[0]()), node[1], load, () => r.loading];
}

export interface LoadStateFunction<T> {
  (
    v: { [P in keyof T]: () => Promise<T[P]> | T[P] },
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
  const loadingTraps = {
    get(nodes: any, property: string | number) {
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

  const resourceTraps = {
    get(target: StateNode, property: string | number | symbol, receiver: any) {
      if (property === $RAW) return target;
      if (property === $PROXY) return receiver;
      if (property === "loading") return new Proxy(getDataNodes(target), loadingTraps);
      const value = target[property as string | number];
      if (property === $NODE || property === "__proto__") return value;

      const wrappable = isWrappable(value);
      if (getListener() && (typeof value !== "function" || target.hasOwnProperty(property))) {
        let nodes, node;
        if (wrappable && (nodes = getDataNodes(value))) {
          node = nodes._ || (nodes._ = createSignal());
          node[0]();
        }
        nodes = getDataNodes(target);
        node =
          nodes[property] ||
          (nodes[property] = createResourceNode(value, `${options.name}:${property as string}`));
        node[0]();
      }
      return wrappable ? wrap(value) : value;
    },

    set() {
      return true;
    },

    deleteProperty() {
      return true;
    }
  };

  const unwrappedState = unwrap<T>(state || {}, true),
    wrappedState = wrap<T & { loading: { [P in keyof T]: boolean } }>(
      unwrappedState as any,
      resourceTraps
    );
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