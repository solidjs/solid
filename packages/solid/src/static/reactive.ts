export const equalFn = <T>(a: T, b: T) => a === b;
const ERROR = Symbol("error");

const UNOWNED: Owner = { context: null, owner: null };
let Owner: Owner | null = null;

interface Owner {
  owner: Owner | null;
  context: any | null;
}

export function createRoot<T>(fn: (dispose: () => void) => T, detachedOwner?: Owner): T {
  detachedOwner && (Owner = detachedOwner);
  const owner = Owner,
    root: Owner = fn.length === 0 ? UNOWNED : { context: null, owner };
  Owner = root;
  let result: T;
  try {
    result = fn(() => {});
  } catch (err) {
    const fns = lookup(Owner, ERROR);
    if (!fns) throw err;
    fns.forEach((f: (err: any) => void) => f(err));
  } finally {
    Owner = owner;
  }
  return result!;
}

export function createSignal<T>(
  value?: T,
  areEqual?: boolean | ((prev: T, next: T) => boolean)
): [() => T, (v: T) => T] {
  return [() => value as T, (v: T) => (value = v)];
}

export function createComputed<T>(fn: (v?: T) => T, value?: T): void {
  Owner = { owner: Owner, context: null };
  fn(value);
  Owner = Owner.owner;
}

export function createRenderEffect<T>(fn: (v?: T) => T, value?: T): void {
  Owner = { owner: Owner, context: null };
  fn(value);
  Owner = Owner.owner;
}

export function createEffect<T>(fn: (v?: T) => T, value?: T): void {}

export function createMemo<T>(
  fn: (v?: T) => T,
  value?: T,
  areEqual?: boolean | ((prev: T, next: T) => boolean)
): () => T {
  Owner = { owner: Owner, context: null };
  const v = fn(value);
  Owner = Owner.owner;
  return () => v;
}

export function createDeferred<T>(source: () => T, options?: { timeoutMs: number }) {
  return source;
}

export function createSelector<T>(
  source: () => T,
  fn: (k: T, value: T, prevValue: T | undefined) => boolean
) {
  return source;
}

export function batch<T>(fn: () => T): T {
  return fn();
}

export function untrack<T>(fn: () => T): T {
  return fn();
}

type ReturnTypeArray<T> = { [P in keyof T]: T[P] extends (() => infer U) ? U : never };
export function on<T, X extends Array<() => T>, U>(
  ...args: X['length'] extends 1
    ? [w: () => T, fn: (v: T, prev: T | undefined, prevResults?: U) => U]
    : [...w: X, fn: (v: ReturnTypeArray<X>, prev: ReturnTypeArray<X> | [], prevResults?: U) => U]
): (prev?: U) => U {
  const fn = args.pop() as (v: T | Array<T>, p?: T | Array<T>, r?: U) => U;
  let deps: (() => T) | Array<() => T>;
  let isArray = true;
  let prev: T | T[];
  if (args.length < 2) {
    deps = args[0] as () => T;
    isArray = false;
  } else deps = args as Array<() => T>;
  return prevResult => {
    let value: T | Array<T>;
    if (isArray) {
      value = [];
      if (!prev) prev = [];
      for (let i = 0; i < deps.length; i++) value.push((deps as Array<() => T>)[i]());
    } else value = (deps as () => T)();
    return fn!(value, prev, prevResult);
  };
}

export function onMount(fn: () => void) {}

export function onCleanup(fn: () => void) {}

export function onError(fn: (err: any) => void): void {
  if (Owner === null)
    "_SOLID_DEV_" &&
      console.warn("error handlers created outside a `createRoot` or `render` will never be run");
  else if (Owner.context === null) Owner.context = { [ERROR]: [fn] };
  else if (!Owner.context[ERROR]) Owner.context[ERROR] = [fn];
  else Owner.context[ERROR].push(fn);
}

export function getListener() {
  return null;
}

// Context API
export interface Context<T> {
  id: symbol;
  Provider: (props: { value: T; children: any }) => any;
  defaultValue?: T;
}

export function createContext<T>(defaultValue?: T): Context<T> {
  const id = Symbol("context");
  return { id, Provider: createProvider(id), defaultValue };
}

export function useContext<T>(context: Context<T>): T {
  return lookup(Owner, context.id) || context.defaultValue;
}

export function getContextOwner() {
  return Owner;
}

function lookup(owner: Owner | null, key: symbol | string): any {
  return (
    owner && ((owner.context && owner.context[key]) || (owner.owner && lookup(owner.owner, key)))
  );
}

function resolveChildren(children: any): any {
  if (typeof children === "function") return resolveChildren(children());
  if (Array.isArray(children)) {
    const results: any[] = [];
    for (let i = 0; i < children.length; i++) {
      let result = resolveChildren(children[i]);
      Array.isArray(result) ? results.push.apply(results, result) : results.push(result);
    }
    return results;
  }
  return children;
}

function createProvider(id: symbol) {
  return function provider(props: { value: unknown; children: any }) {
    let rendered;
    createRenderEffect(() => {
      Owner!.context = { [id]: props.value };
      rendered = resolveChildren(props.children);
    });
    return rendered;
  };
}

export interface Task {
  id: number;
  fn: ((didTimeout: boolean) => void) | null;
  startTime: number;
  expirationTime: number;
}
export function requestCallback(fn: () => void, options?: { timeout: number }): Task {
  return { id: 0, fn: () => {}, startTime: 0, expirationTime: 0 };
}
export function cancelCallback(task: Task) {}

export const $RAW = Symbol("state-raw");

// well-known symbols need special treatment until https://github.com/microsoft/TypeScript/issues/24622 is implemented.
type AddSymbolToPrimitive<T> = T extends { [Symbol.toPrimitive]: infer V }
  ? { [Symbol.toPrimitive]: V }
  : {};
type AddCallable<T> = T extends { (...x: any[]): infer V } ? { (...x: Parameters<T>): V } : {};

type NotWrappable = string | number | boolean | Function | null;
export type State<T> = {
  [P in keyof T]: T[P] extends object ? State<T[P]> : T[P];
} & {
  [$RAW]?: T;
} & AddSymbolToPrimitive<T> &
  AddCallable<T>;

export function isWrappable(obj: any) {
  return (
    obj != null &&
    typeof obj === "object" &&
    (obj.__proto__ === Object.prototype || Array.isArray(obj))
  );
}

export function unwrap<T>(item: any): T {
  return item;
}

export function setProperty(state: any, property: string | number, value: any, force?: boolean) {
  if (!force && state[property] === value) return;
  if (value === undefined) {
    delete state[property];
  } else state[property] = value;
}

function mergeState(state: any, value: any, force?: boolean) {
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    setProperty(state, key, value[key], force);
  }
}

export function updatePath(current: any, path: any[], traversed: (number | string)[] = []) {
  let part,
    next = current;
  if (path.length > 1) {
    part = path.shift();
    const partType = typeof part,
      isArray = Array.isArray(current);

    if (Array.isArray(part)) {
      // Ex. update('data', [2, 23], 'label', l => l + ' !!!');
      for (let i = 0; i < part.length; i++) {
        updatePath(current, [part[i]].concat(path), [part[i]].concat(traversed));
      }
      return;
    } else if (isArray && partType === "function") {
      // Ex. update('data', i => i.id === 42, 'label', l => l + ' !!!');
      for (let i = 0; i < current.length; i++) {
        if (part(current[i], i))
          updatePath(current, [i].concat(path), ([i] as (number | string)[]).concat(traversed));
      }
      return;
    } else if (isArray && partType === "object") {
      // Ex. update('data', { from: 3, to: 12, by: 2 }, 'label', l => l + ' !!!');
      const { from = 0, to = current.length - 1, by = 1 } = part;
      for (let i = from; i <= to; i += by) {
        updatePath(current, [i].concat(path), ([i] as (number | string)[]).concat(traversed));
      }
      return;
    } else if (path.length > 1) {
      updatePath(current[part], path, [part].concat(traversed));
      return;
    }
    next = current[part];
    traversed = [part].concat(traversed);
  }
  let value = path[0];
  if (typeof value === "function") {
    value = value(next, traversed);
    if (value === next) return;
  }
  if (part === undefined && value == undefined) return;
  if (part === undefined || (isWrappable(next) && isWrappable(value) && !Array.isArray(value))) {
    mergeState(next, value);
  } else setProperty(current, part, value);
}

type StateSetter<T> =
  | Partial<T>
  | ((
      prevState: T extends NotWrappable ? T : State<T>,
      traversed?: (string | number)[]
    ) => Partial<T> | void);
type StatePathRange = { from?: number; to?: number; by?: number };

type ArrayFilterFn<T> = (item: T extends any[] ? T[number] : never, index: number) => boolean;

type Part<T> = keyof T | Array<keyof T> | StatePathRange | ArrayFilterFn<T>; // changing this to "T extends any[] ? ArrayFilterFn<T> : never" results in depth limit errors

type Next<T, K> = K extends keyof T
  ? T[K]
  : K extends Array<keyof T>
  ? T[K[number]]
  : T extends any[]
  ? K extends StatePathRange
    ? T[number]
    : K extends ArrayFilterFn<T>
    ? T[number]
    : never
  : never;

export interface SetStateFunction<T> {
  <Setter extends StateSetter<T>>(...args: [Setter]): void;
  <K1 extends Part<T>, Setter extends StateSetter<Next<T, K1>>>(...args: [K1, Setter]): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    Setter extends StateSetter<Next<Next<T, K1>, K2>>
  >(
    ...args: [K1, K2, Setter]
  ): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    Setter extends StateSetter<Next<Next<Next<T, K1>, K2>, K3>>
  >(
    ...args: [K1, K2, K3, Setter]
  ): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    K4 extends Part<Next<Next<Next<T, K1>, K2>, K3>>,
    Setter extends StateSetter<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>>
  >(
    ...args: [K1, K2, K3, K4, Setter]
  ): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    K4 extends Part<Next<Next<Next<T, K1>, K2>, K3>>,
    K5 extends Part<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>>,
    Setter extends StateSetter<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>>
  >(
    ...args: [K1, K2, K3, K4, K5, Setter]
  ): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    K4 extends Part<Next<Next<Next<T, K1>, K2>, K3>>,
    K5 extends Part<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>>,
    K6 extends Part<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>>,
    Setter extends StateSetter<Next<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>, K6>>
  >(
    ...args: [K1, K2, K3, K4, K5, K6, Setter]
  ): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    K4 extends Part<Next<Next<Next<T, K1>, K2>, K3>>,
    K5 extends Part<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>>,
    K6 extends Part<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>>,
    K7 extends Part<Next<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>, K6>>,
    Setter extends StateSetter<
      Next<Next<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>, K6>, K7>
    >
  >(
    ...args: [K1, K2, K3, K4, K5, K6, K7, Setter]
  ): void;

  // and here we give up on being accurate after 8 args
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    K4 extends Part<Next<Next<Next<T, K1>, K2>, K3>>,
    K5 extends Part<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>>,
    K6 extends Part<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>>,
    K7 extends Part<Next<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>, K6>>,
    K8 extends Part<Next<Next<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>, K6>, K7>>
  >(
    ...args: [K1, K2, K3, K4, K5, K6, K7, K8, ...(Part<any> | StateSetter<any>)[]]
  ): void;
}

export function createState<T>(state: T | State<T>): [State<T>, SetStateFunction<T>] {
  function setState(...args: any[]): void {
    updatePath(state, args);
  }
  return [state as State<T>, setState];
}

type ReconcileOptions = {
  key?: string | null;
  merge?: boolean;
};

// Diff method for setState
export function reconcile<T>(
  value: T | State<T>,
  options: ReconcileOptions = {}
): (state: T extends NotWrappable ? T : State<T>) => void {
  return state => {
    if (!isWrappable(state)) return value;
    const targetKeys = Object.keys(value) as (keyof T)[];
    for (let i = 0, len = targetKeys.length; i < len; i++) {
      const key = targetKeys[i];
      setProperty(state, key as string, value[key]);
    }
    const previousKeys = Object.keys(state) as (keyof T)[];
    for (let i = 0, len = previousKeys.length; i < len; i++) {
      if (value[previousKeys[i]] === undefined)
        setProperty(state, previousKeys[i] as string, undefined);
    }
  };
}

// Immer style mutation style
export function produce<T>(
  fn: (state: T) => void
): (state: T extends NotWrappable ? T : State<T>) => T extends NotWrappable ? T : State<T> {
  return state => {
    if (isWrappable(state)) fn(state as T);
    return state;
  };
}

export function mapArray<T, U>(
  list: () => T[],
  mapFn: (v: T, i: () => number) => U,
  options: { fallback?: () => any } = {}
): () => U[] {
  const items = list();
  let s: U[] = [];
  if (items.length) {
    for (let i = 0, len = items.length; i < len; i++) s.push(mapFn(items[i], () => i));
  } else if (options.fallback) s = [options.fallback()];
  return () => s;
}
