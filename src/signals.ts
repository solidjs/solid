// Modified version of S.js[https://github.com/adamhaile/S] by Adam Haile

// Public interface
export function createSignal<T>(value?: T, comparator?: (v?: T, p?: T) => boolean): [() => T, (v: T) => void] {
  const d = new DataNode(value);
  let setter;
  if (comparator) {
    let age = -1;
    setter = (v: T) => {
      if (!comparator(value, v)) {
        const time = RootClock.time;
        if (time === age) {
          throw new Error(`Conflicting value update: ${v} is not the same as ${value}`);
        }
        age = time;
        value = v;
        d.next(v);
      }
    };
  } else setter = d.next.bind(d);
  return [d.current.bind(d), setter];
}

export function createEffect<T>(fn: (v?: T) => T, seed?: T) { makeComputationNode(fn, seed, false, false); }

// explicit dependencies and defered initial execution
export function createDependentEffect<T>(fn: (v?: T) => T, deps: () => any | (() => any)[], defer?: boolean) {
  if (Array.isArray(deps)) deps = callAll(deps);
  defer = !!defer;

  return createEffect(on);

  function on(value: T | undefined): T {
    var listener = Listener;
    deps();
    if (defer) defer = false;
    else {
      Listener = null;
      value = fn(value);
      Listener = listener;
    }
    return value as T;
  }
}

const EQUAL = (a: any, b: any) => a === b
export function createMemo<T>(fn: (v: T | undefined) => T, value?: T, comparator?: (v?: T, p?: T) => boolean): () => T {
  if (Owner === null) console.warn("computations created without a root or parent will never be disposed");

  // TODO: Restore synchronicity
  comparator || (comparator = EQUAL);
  const [s, set] = createSignal(fn(undefined), comparator);
  makeComputationNode(v => (set(v = fn(v)), v), value, false, false)
  return s;
};

export function createRoot<T>(fn: (dispose: () => void) => T, detachedOwner?: ComputationNode): T {
  var owner = Owner,
    disposer = fn.length === 0 ? null : function _dispose() {
      if (root === null) {
        // nothing to dispose
      } else if (RunningClock !== null) {
        RootClock.disposes.add(root);
      } else {
        dispose(root);
      }
    },
    root = disposer === null ? UNOWNED : getCandidateNode(),
    result: T;
  let potentialOwner = detachedOwner || Owner;
  root !== potentialOwner && (root.owner = potentialOwner);
  Owner = root;

  try {
    result = disposer === null ? (fn as any)() : fn(disposer);
  } finally {
    Owner = owner;
  }
  afterNode(root);

  if (disposer !== null && recycleOrClaimNode(root, null as any, undefined, true)) {
    root = null!;
  }

  return result;
};

export function freeze<T>(fn: () => T): T {
  var result: T = undefined!;

  if (RunningClock !== null) {
    result = fn();
  } else {
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
};

export function sample<T>(fn: () => T): T {
  var result: T,
    listener = Listener;

  Listener = null;
  result = fn();
  Listener = listener;

  return result;
}

export function onCleanup(fn: (final: boolean) => void): void {
  if (Owner === null) console.warn("cleanups created without a root or parent will never be run");
  else if (Owner.cleanups === null) Owner.cleanups = [fn];
  else Owner.cleanups.push(fn);
};

export function afterEffects(fn: () => void): void {
  if (Owner === null) console.warn("afterEffects created without a root or parent will never be run");
  else if (Owner.afters === null) Owner.afters = [fn];
  else Owner.afters.push(fn);
}

export function isListening() {
  return Listener !== null;
};

// context API

export interface Context { id: symbol, initFn?: Function };

export function createContext(initFn?: Function): Context {
  const id = Symbol('context');
  return { id, initFn };
}

export function useContext(context: Context) {
  if (Owner === null) return console.warn("Context keys cannot be looked up without a root or parent");
  return lookup(Owner, context.id);
}

export function getContextOwner() {
  Owner && (Owner.noRecycle = true);
  return Owner;
}

export function setContext(key: symbol | string, value: any) {
  if (Owner === null) return console.warn("Context keys cannot be set without a root or parent");
  const context = Owner.context || (Owner.context = {});
  Owner.noRecycle = true;
  context[key] = value;
}

// Internal implementation

/// Graph classes and operations
export class DataNode {
  pending: any;
  log: Log | null;

  constructor(public value: any) {
    this.pending = NOTPENDING;
    this.log = null;
  }

  current() {
    if (Listener !== null) {
      logDataRead(this);
    }
    return this.value;
  }

  next(value: any) {
    if (RunningClock !== null) {
      if (this.pending !== NOTPENDING) { // value has already been set once, check for conflicts
        if (value !== this.pending) {
          throw new Error("conflicting changes: " + value + " !== " + this.pending);
        }
      } else { // add to list of changes
        this.pending = value;
        RootClock.changes.add(this);
      }
    } else { // not batching, respond to change now
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

class ComputationNode {
  fn: ((v: any) => any) | null;
  value: any;
  age: number;
  state: number;
  source1: null | Log;
  source1slot: number;
  sources: null | Log[];
  sourceslots: null | number[];
  owner: any;
  context: any;
  noRecycle?: boolean;
  owned: ComputationNode[] | null;
  cleanups: (((final: boolean) => void)[]) | null;
  afters: ((() => void)[]) | null;

  constructor() {
    this.fn = null;
    this.age = -1
    this.state = CURRENT;
    this.source1 = null;
    this.source1slot = 0;
    this.sources = null;
    this.sourceslots = null;
    this.owner = null;
    this.owned = null;
    this.cleanups = null;
    this.afters = null;
  }
}

type Clock = {
  time: number;
  changes: Queue<DataNode>;
  updates: Queue<ComputationNode>;
  disposes: Queue<ComputationNode>;
}
function createClock() {
  return {
    time: 0,
    changes: new Queue<DataNode>(), // batched changes to data nodes
    updates: new Queue<ComputationNode>(), // computations to update
    disposes: new Queue<ComputationNode>(), // disposals to run after current batch of updates finishes
  }
}

type Log = {
  node1: null | ComputationNode,
  node1slot: number,
  nodes: null | ComputationNode[],
  nodeslots: null | number[]
}
function createLog(): Log {
  return {
    node1: null as null | ComputationNode,
    node1slot: 0,
    nodes: null as null | ComputationNode[],
    nodeslots: null as null | number[]
  }
}

class Queue<T> {
  count: number;
  items: T[]

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
    var items = this.items;
    for (var i = 0; i < this.count; i++) {
      fn(items[i]!);
      items[i] = null!;
    }
    this.count = 0;
  }
}

// Constants
var NOTPENDING = {},
  CURRENT = 0,
  STALE = 1,
  RUNNING = 2,
  UNOWNED = new ComputationNode();

// "Globals" used to keep track of current system state
var RootClock = createClock(),
  RunningClock = null as any, // currently running clock
  Listener = null as ComputationNode | null, // currently listening computation
  Owner = null as ComputationNode | null, // owner for new computations
  LastNode = null as ComputationNode | null; // cached unused node, for re-use

// Functions
function callAll(ss: (() => any)[]) {
  return function all() {
    for (var i = 0; i < ss.length; i++) ss[i]();
  }
}

function lookup(owner: ComputationNode, key: symbol | string): any {
  return (owner && owner.context && owner.context[key]) || (owner.owner && lookup(owner.owner, key));
}

function makeComputationNode<T>(fn: (v: T | undefined) => T, value: T | undefined, orphan: boolean, sample: boolean): void {
  var node = getCandidateNode(),
    listener = Listener,
    toplevel = RunningClock === null;

  node.owner = Owner;
  Owner = node;
  Listener = sample ? null : node;

  if (toplevel) {
    value = execToplevelComputation(fn, value as T);
  } else {
    value = fn(value);
  }

  Owner = node.owner;
  Listener = listener;

  afterNode(node);
  recycleOrClaimNode(node, fn, value, orphan);
  if (toplevel) finishToplevelComputation(Owner, listener);
}

function execToplevelComputation<T>(fn: (v: T | undefined) => T, value: T) {
  RunningClock = RootClock;
  RootClock.changes.reset();
  RootClock.updates.reset();

  try {
    return fn(value);
  } finally {
    Owner = Listener = RunningClock = null;
  }
}

function finishToplevelComputation(owner: ComputationNode | null, listener: ComputationNode | null) {
  if (RootClock.changes.count > 0 || RootClock.updates.count > 0) {
    RootClock.time++;
    try {
      run(RootClock);
    } finally {
      RunningClock = null;
      Owner = owner;
      Listener = listener;
    }
  }
}

function getCandidateNode() {
  var node = LastNode;
  if (node === null) node = new ComputationNode();
  else LastNode = null;
  return node;
}

function recycleOrClaimNode<T>(node: ComputationNode, fn: (v: T | undefined) => T, value: T, orphan: boolean) {
  var _owner = orphan || Owner === null || Owner === UNOWNED ? null : Owner,
    recycle = !node.noRecycle && node.source1 === null && (node.owned === null && node.cleanups === null || _owner !== null),
    i: number;

  if (recycle) {
    LastNode = node;
    node.owner = null;

    if (_owner !== null) {
      if (node.owned !== null) {
        if (_owner.owned === null) _owner.owned = node.owned;
        else for (i = 0; i < node.owned.length; i++) {
          _owner.owned.push(node.owned[i]);
        }
        node.owned = null;
      }

      if (node.cleanups !== null) {
        if (_owner.cleanups === null) _owner.cleanups = node.cleanups;
        else for (i = 0; i < node.cleanups.length; i++) {
          _owner.cleanups.push(node.cleanups[i]);
        }
        node.cleanups = null;
      }

      if (node.afters !== null) {
        if (_owner.afters === null) _owner.afters = node.afters;
        else for (i = 0; i < node.afters.length; i++) {
          _owner.afters.push(node.afters[i]);
        }
        node.afters = null;
      }
    }
  } else {
    node.fn = fn;
    node.value = value;
    node.age = RootClock.time;

    if (_owner !== null) {
      if (_owner.owned === null) _owner.owned = [node];
      else _owner.owned.push(node);
    }
  }

  return recycle;
}

function logRead(from: Log) {
  var to = Listener!,
    fromslot: number,
    toslot = to.source1 === null ? -1 : to.sources === null ? 0 : to.sources.length;

  if (from.node1 === null) {
    from.node1 = to;
    from.node1slot = toslot;
    fromslot = -1;
  } else if (from.nodes === null) {
    from.nodes = [to];
    from.nodeslots = [toslot];
    fromslot = 0;
  } else {
    fromslot = from.nodes.length;
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

function logDataRead(data: DataNode) {
  if (data.log === null) data.log = createLog();
  logRead(data.log);
}

function event() {
  // b/c we might be under a top level S.root(), have to preserve current root
  var owner = Owner;
  RootClock.updates.reset();
  RootClock.time++;
  try {
    run(RootClock);
  } finally {
    RunningClock = Listener = null;
    Owner = owner;
  }
}

function run(clock: Clock) {
  var running = RunningClock,
    count = 0;

  RunningClock = clock;

  clock.disposes.reset();

  // for each batch ...
  while (clock.changes.count !== 0 || clock.updates.count !== 0 || clock.disposes.count !== 0) {
    if (count > 0) // don't tick on first run, or else we expire already scheduled updates
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
  if (data.log) markComputationsStale(data.log);
}

function markComputationsStale(log: Log) {
  var node1 = log.node1,
    nodes = log.nodes;

  // mark all downstream nodes stale which haven't been already
  if (node1 !== null) markNodeStale(node1);
  if (nodes !== null) {
    for (var i = 0, len = nodes.length; i < len; i++) {
      markNodeStale(nodes[i]);
    }
  }
}

function markNodeStale(node: ComputationNode) {
  var time = RootClock.time;
  if (node.age < time) {
    node.age = time;
    node.state = STALE;
    RootClock.updates.add(node);
    if (node.owned !== null) markOwnedNodesForDisposal(node.owned);
  }
}

function markOwnedNodesForDisposal(owned: ComputationNode[]) {
  for (var i = 0; i < owned.length; i++) {
    var child = owned[i];
    child.age = RootClock.time;
    child.state = CURRENT;
    if (child.owned !== null) markOwnedNodesForDisposal(child.owned);
  }
}

function updateNode(node: ComputationNode) {
  if (node.state === STALE) {
    var owner = Owner,
      listener = Listener;

    Owner = Listener = node;

    node.state = RUNNING;
    cleanupNode(node, false);
    node.value = node.fn!(node.value);
    node.state = CURRENT;
    afterNode(node);

    Owner = owner;
    Listener = listener;
  }
}

function afterNode(node: ComputationNode) {
  var i, afters = node.afters;

  if (afters !== null) {
    Promise.resolve().then(() => {
      for (i = 0; i < afters!.length; i++) afters![i]();
    });
    node.afters = null;
  }
}

function cleanupNode(node: ComputationNode, final: boolean) {
  var source1 = node.source1,
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
  var nodes = source.nodes!,
    nodeslots = source.nodeslots!,
    last: ComputationNode,
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

function dispose(node: ComputationNode) {
  node.fn = null;
  node.owner = null;
  node.afters = null;
  cleanupNode(node, true);
}