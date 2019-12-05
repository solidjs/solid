// Modified version of S.js[https://github.com/adamhaile/S] by Adam Haile
// Comparator memos from VSJolund fork https://github.com/VSjolund/vs-bind

// Public interface
export function createRoot<T>(
  fn: (dispose: () => void) => T,
  detachedOwner?: ComputationNode<any>
): T {
  detachedOwner && (Owner = detachedOwner);
  let owner = Owner,
    listener = Listener,
    root = fn.length === 0 ? UNOWNED : createComputationNode(null!, null),
    result: T = undefined!,
    disposer = function _dispose() {
      if (RunningClock !== null) {
        RootClock.disposes.add(root);
      } else {
        dispose(root);
      }
    };

  Owner = root;
  Listener = null;

  try {
    result = fn(disposer);
  } finally {
    Listener = listener;
    Owner = owner;
  }

  return result;
}

export function createSignal<T>(
  value?: T,
  comparator?: (v: T, p: T) => boolean
): [() => T, (v: T) => void] {
  const d = new DataNode(value);
  let setter;
  if (comparator) {
    let age = -1;
    setter = (v: T) => {
      if (!comparator(value!, v)) {
        const time = RootClock.time;
        if (time === age) {
          throw new Error(
            `Conflicting value update: ${v} is not the same as ${value}`
          );
        }
        age = time;
        value = v;
        d.next(v);
      }
    };
  } else setter = d.next.bind(d);
  return [d.current.bind(d), setter];
}

export function createEffect<T>(fn: (v?: T) => T, value?: T): void {
  createComputationNode(fn, value);
}

export function createDependentEffect<T>(
  fn: (v?: T) => T,
  deps: (() => any) | (() => any)[],
  defer?: boolean
) {
  const resolved = Array.isArray(deps) ? callAll(deps) : deps;
  defer = !!defer;
  createEffect<T>((value: T | undefined) => {
    const listener = Listener;
    resolved();
    if (defer) defer = false;
    else {
      Listener = null;
      value = fn(value);
      Listener = listener;
    }
    return value!;
  });
}

export function createMemo<T>(
  fn: (v: T | undefined) => T,
  value?: T,
  comparator?: (a: T, b: T) => boolean
): () => T {
  var node = createComputationNode(fn, value);
  node.comparator = comparator || null;
  return () => {
    if (Listener !== null) {
      const state = node!.state;
      if ((state & 7) !== 0) {
        liftComputation(node!);
      }
      if (node!.age === RootClock.time && state === 8) {
        throw new Error("Circular dependency.");
      }
      if ((state & 16) === 0) {
        if (node!.log === null) node!.log = createLog();
        logRead(node!.log);
      }
    }
    return node!.value!;
  };
}

const schedule = window.requestIdleCallback
    ? requestIdleCallback
    : requestAnimationFrame,
  cancel = window.cancelIdleCallback
    ? cancelIdleCallback
    : cancelAnimationFrame;

export function createDeferred<T>(
  fn: (prev: T | undefined) => T,
  options?: { timeoutMs: number }
) {
  let handle: number;
  const [v, setV] = createSignal<T>(),
    timeout = options && options.timeoutMs;
  createEffect<T>(prev => {
    const value = fn(prev);
    cancel(handle);
    handle = schedule(() => setV(value), timeout ? { timeout } : undefined);
    return value;
  });

  return v;
}

export function freeze<T>(fn: () => T): T {
  let result: T = undefined!;

  if (RunningClock !== null) result = fn();
  else {
    RunningClock = RootClock;
    RunningClock.changes.reset();

    try {
      result = fn();
      event();
    } finally {
      RunningClock = null;
    }
  }

  return result;
}

export function sample<T>(fn: () => T): T {
  let result: T,
    listener = Listener;

  Listener = null;
  result = fn();
  Listener = listener;

  return result;
}

export function onCleanup(fn: (final: boolean) => void): void {
  if (Owner === null)
    console.warn("cleanups created without a root or parent will never be run");
  else if (Owner.cleanups === null) Owner.cleanups = [fn];
  else Owner.cleanups.push(fn);
}

export function afterEffects(fn: () => void): void {
  Promise.resolve().then(fn);
}

export function isListening() {
  return Listener !== null;
}

// context API
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

// Internal implementation

/// Graph classes and operations
export class DataNode {
  pending: any;
  log: Log | null;

  constructor(public value?: any) {
    this.pending = NOTPENDING;
    this.log = null;
  }

  current() {
    if (Listener !== null) {
      if (this.log === null) this.log = createLog();
      logRead(this.log);
    }
    return this.value;
  }

  next(value: any) {
    if (RunningClock !== null) {
      if (this.pending !== NOTPENDING) {
        // value has already been set once, check for conflicts
        if (value !== this.pending) {
          throw new Error(
            "conflicting changes: " + value + " !== " + this.pending
          );
        }
      } else {
        // add to list of changes
        this.pending = value;
        RootClock.changes.add(this);
      }
    } else {
      // not batching, respond to change now
      if (this.log !== null) {
        this.pending = value;
        RootClock.changes.add(this);
        event();
      } else {
        this.value = value;
      }
    }
    return value!;
  }
}

type ComputationNode<T> = {
  fn: ((v: T) => T) | null;
  value: T | undefined;
  comparator: null | ((a: T, b: T) => boolean);
  age: number;
  state: number;
  source1: null | Log;
  source1slot: number;
  sources: null | Log[];
  sourceslots: null | number[];
  dependents: null | (ComputationNode<any> | null)[];
  dependentslot: number;
  dependentcount: number;
  owner: ComputationNode<any> | null;
  log: Log | null;
  context: any;
  owned: ComputationNode<any>[] | null;
  cleanups: ((final: boolean) => void)[] | null;
};

function createComputationNode<T>(
  fn: (v: T | undefined) => T,
  value?: T
): ComputationNode<T> {
  const node: ComputationNode<T> = {
    fn,
    value,
    age: RootClock.time,
    state: 0,
    comparator: null,
    source1: null,
    source1slot: 0,
    sources: null,
    sourceslots: null,
    dependents: null,
    dependentslot: 0,
    dependentcount: 0,
    owner: Owner,
    owned: null,
    log: null,
    context: null,
    cleanups: null
  };

  if (fn === null) return node;

  let owner = Owner,
    listener = Listener;

  if (owner === null)
    console.warn(
      "computations created without a root or parent will never be disposed"
    );

  Owner = Listener = node;

  if (RunningClock === null) {
    toplevelComputation(node);
  } else {
    node.value = node.fn!(node.value!);
  }

  if (owner && owner !== UNOWNED) {
    if (owner.owned === null) owner.owned = [node];
    else owner.owned.push(node);
  }

  Owner = owner;
  Listener = listener;
  return node;
}

type Clock = {
  time: number;
  changes: Queue<DataNode>;
  updates: Queue<ComputationNode<any>>;
  disposes: Queue<ComputationNode<any>>;
};
function createClock() {
  return {
    time: 0,
    changes: new Queue<DataNode>(), // batched changes to data nodes
    updates: new Queue<ComputationNode<any>>(), // computations to update
    disposes: new Queue<ComputationNode<any>>() // disposals to run after current batch of updates finishes
  };
}

type Log = {
  node1: null | ComputationNode<unknown>;
  node1slot: number;
  nodes: null | ComputationNode<unknown>[];
  nodeslots: null | number[];
};
function createLog(): Log {
  return {
    node1: null,
    node1slot: 0,
    nodes: null,
    nodeslots: null
  };
}

class Queue<T> {
  count: number;
  items: T[];

  constructor() {
    this.items = [];
    this.count = 0;
  }

  reset() {
    this.count = 0;
  }

  add(item: T) {
    this.items[this.count++] = item;
  }

  run(fn: (item: T) => void) {
    let items = this.items;
    for (let i = 0; i < this.count; i++) {
      fn(items[i]!);
      items[i] = null!;
    }
    this.count = 0;
  }
}

// "Globals" used to keep track of current system state
let RootClock = createClock(),
  RunningClock = null as any, // currently running clock
  Listener = null as ComputationNode<any> | null, // currently listening computation
  Owner = null as ComputationNode<any> | null, // owner for new computations
  Pending = null as ComputationNode<any> | null; // pending node

// Constants
let NOTPENDING = {},
  UNOWNED = createComputationNode(null!, null);

// State
// 1 - Stale, 2 - Pending, 4 - Pending Disposal, 8 - Running, 16 - Disposed

// Functions
function callAll(ss: (() => any)[]) {
  return function all() {
    for (let i = 0; i < ss.length; i++) ss[i]();
  };
}

function lookup(owner: ComputationNode<any> | null, key: symbol | string): any {
  return (
    owner &&
    ((owner.context && owner.context[key]) ||
      (owner.owner && lookup(owner.owner, key)))
  );
}

function resolveChildren(children: any): any {
  if (typeof children === "function")
    return createMemo(() => resolveChildren(children()));
  if (Array.isArray(children)) {
    const results: any[] = [];
    for (let i = 0; i < children.length; i++) {
      let result = resolveChildren(children[i]);
      Array.isArray(result)
        ? results.push.apply(results, result)
        : results.push(result);
    }
    return results;
  }
  return children;
}

function createProvider(id: symbol) {
  return function provider(props: { value: unknown; children: any }) {
    let rendered;
    createComputationNode(() => {
      Owner!.context = { [id]: props.value };
      rendered = sample(() => resolveChildren(props.children));
    });
    return rendered;
  };
}

function logRead(from: Log) {
  let to = Listener!,
    fromslot: number,
    toslot =
      to.source1 === null ? -1 : to.sources === null ? 0 : to.sources.length;

  if (from.node1 === null) {
    from.node1 = to;
    from.node1slot = toslot;
    fromslot = -1;
  } else if (from.nodes === null) {
    if (from.node1 === to) return;
    from.nodes = [to];
    from.nodeslots = [toslot];
    fromslot = 0;
  } else {
    fromslot = from.nodes.length;
    if (from.nodes[fromslot - 1] === to) return;
    from.nodes.push(to);
    from.nodeslots!.push(toslot);
  }

  if (to.source1 === null) {
    to.source1 = from;
    to.source1slot = fromslot;
  } else if (to.sources === null) {
    to.sources = [from];
    to.sourceslots = [fromslot];
  } else {
    to.sources.push(from);
    to.sourceslots!.push(fromslot);
  }
}

function liftComputation(node: ComputationNode<any>) {
  if ((node.state & 6) !== 0) {
    applyUpstreamUpdates(node);
  }
  if ((node.state & 1) !== 0) {
    updateNode(node);
  }
  resetComputation(node, 31);
}

function event() {
  // b/c we might be under a top level S.root(), have to preserve current root
  let owner = Owner;
  RootClock.updates.reset();
  RootClock.time++;
  try {
    run(RootClock);
  } finally {
    RunningClock = Listener = null;
    Owner = owner;
  }
}

function toplevelComputation<T>(node: ComputationNode<any>) {
  RunningClock = RootClock;
  RootClock.changes.reset();
  RootClock.updates.reset();

  try {
    node.value = node.fn!(node.value);

    if (RootClock.changes.count > 0 || RootClock.updates.count > 0) {
      RootClock.time++;
      run(RootClock);
    }
  } finally {
    RunningClock = Owner = Listener = null;
  }
}

function run(clock: Clock) {
  let running = RunningClock,
    count = 0;
  RunningClock = clock;
  clock.disposes.reset();

  // for each batch ...
  while (
    clock.changes.count !== 0 ||
    clock.updates.count !== 0 ||
    clock.disposes.count !== 0
  ) {
    if (count > 0)
      // don't tick on first run, or else we expire already scheduled updates
      clock.time++;

    clock.changes.run(applyDataChange);
    clock.updates.run(updateNode);
    clock.disposes.run(dispose);

    // if there are still changes after excessive batches, assume runaway
    if (count++ > 1e5) {
      throw new Error("Runaway clock detected");
    }
  }

  RunningClock = running;
}

function applyDataChange(data: DataNode) {
  data.value = data.pending;
  data.pending = NOTPENDING;
  if (data.log) setComputationState(data.log, stateStale);
}

function updateNode(node: ComputationNode<any>) {
  const state = node.state;
  if ((state & 16) === 0) {
    if ((state & 2) !== 0) {
      node.dependents![node.dependentslot++] = null;
      if (node.dependentslot === node.dependentcount) {
        resetComputation(node, 14);
      }
    } else if ((state & 1) !== 0) {
      if ((state & 4) !== 0) {
        liftComputation(node);
      } else if (node.comparator) {
        const current = updateComputation(node);
        const comparator = node.comparator;
        if (!comparator(current, node.value)) {
          markDownstreamComputations(node, false, true);
        }
      } else {
        updateComputation(node);
      }
    }
  }
}

function updateComputation(node: ComputationNode<any>) {
  const value = node.value,
    owner = Owner,
    listener = Listener;
  Owner = Listener = node;
  node.state = 8;
  cleanupNode(node, false);
  node.value = node.fn!(node.value);
  resetComputation(node, 31);
  Owner = owner;
  Listener = listener;
  return value;
}

function stateStale(node: ComputationNode<any>) {
  const time = RootClock.time;
  if (node.age < time) {
    node.state |= 1;
    node.age = time;
    setDownstreamState(node, !!node.comparator);
  }
}

function statePending(node: ComputationNode<any>) {
  const time = RootClock.time;
  if (node.age < time) {
    node.state |= 2;
    let dependents = node.dependents || (node.dependents = []);
    dependents[node.dependentcount++] = Pending;
    setDownstreamState(node, true);
  }
}

function pendingStateStale(node: ComputationNode<any>) {
  if ((node.state & 2) !== 0) {
    node.state = 1;
    const time = RootClock.time;
    if (node.age < time) {
      node.age = time;
      if (!node.comparator) {
        markDownstreamComputations(node, false, true);
      }
    }
  }
}

function setDownstreamState(node: ComputationNode<any>, pending: boolean) {
  RootClock.updates.add(node);
  if (node.comparator) {
    const pending = Pending;
    Pending = node;
    markDownstreamComputations(node, true, false);
    Pending = pending;
  } else {
    markDownstreamComputations(node, pending, false);
  }
}

function markDownstreamComputations(
  node: ComputationNode<any>,
  onchange: boolean,
  dirty: boolean
) {
  const owned = node.owned;
  if (owned !== null) {
    const pending = onchange && !dirty;
    markForDisposal(owned, pending, RootClock.time);
  }
  const log = node.log;
  if (log !== null) {
    setComputationState(
      log,
      dirty ? pendingStateStale : onchange ? statePending : stateStale
    );
  }
}

function setComputationState(
  log: Log,
  stateFn: (v: ComputationNode<any>) => void
) {
  const node1 = log.node1,
    nodes = log.nodes;
  if (node1 !== null) stateFn(node1);
  if (nodes !== null) {
    for (let i = 0, ln = nodes.length; i < ln; i++) {
      stateFn(nodes[i]);
    }
  }
}

function markForDisposal(
  children: ComputationNode<any>[],
  pending: boolean,
  time: number
) {
  for (let i = 0, ln = children.length; i < ln; i++) {
    const child = children[i];
    if (child !== null) {
      if (pending) {
        if ((child.state & 16) === 0) {
          child.state |= 4;
        }
      } else {
        child.age = time;
        child.state = 16;
      }
      const owned = child.owned;
      if (owned !== null) markForDisposal(owned, pending, time);
    }
  }
}

function applyUpstreamUpdates(node: ComputationNode<any>) {
  if ((node.state & 4) !== 0) {
    const owner = node.owner;
    if ((owner!.state & 7) !== 0) liftComputation(owner!);
    node.state &= ~4;
  }
  if ((node.state & 2) !== 0) {
    const slots = node.dependents;
    for (let i = node.dependentslot, ln = node.dependentcount; i < ln; i++) {
      const slot = slots![i];
      if (slot != null) liftComputation(slot);
      slots![i] = null;
    }
    node.state &= ~2;
  }
}

function cleanupNode(node: ComputationNode<any>, final: boolean) {
  let source1 = node.source1,
    sources = node.sources,
    sourceslots = node.sourceslots,
    cleanups = node.cleanups,
    owned = node.owned,
    i: number,
    len: number;

  if (cleanups !== null) {
    for (i = 0; i < cleanups.length; i++) {
      cleanups[i](final);
    }
    node.cleanups = null;
  }

  if (owned !== null) {
    for (i = 0; i < owned.length; i++) {
      dispose(owned[i]);
    }
    node.owned = null;
  }

  if (source1 !== null) {
    cleanupSource(source1, node.source1slot);
    node.source1 = null;
  }
  if (sources !== null) {
    for (i = 0, len = sources.length; i < len; i++) {
      cleanupSource(sources.pop()!, sourceslots!.pop()!);
    }
  }
}

function cleanupSource(source: Log, slot: number) {
  let nodes = source.nodes!,
    nodeslots = source.nodeslots!,
    last: ComputationNode<any>,
    lastslot: number;
  if (slot === -1) {
    source.node1 = null;
  } else {
    last = nodes.pop()!;
    lastslot = nodeslots.pop()!;
    if (slot !== nodes.length) {
      nodes[slot] = last;
      nodeslots[slot] = lastslot;
      if (lastslot === -1) {
        last.source1slot = slot;
      } else {
        last.sourceslots![lastslot] = slot;
      }
    }
  }
}

function resetComputation(node: ComputationNode<any>, flags: number) {
  node.state &= ~flags;
  node.dependentslot = 0;
  node.dependentcount = 0;
}

function dispose(node: ComputationNode<any>) {
  node.fn = null;
  node.log = null;
  node.dependents = null;
  cleanupNode(node, true);
  resetComputation(node, 31);
}
