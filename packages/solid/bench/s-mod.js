// Modified version of S.js[https://github.com/adamhaile/S] by Adam Haile
// Comparator memos from VSJolund fork https://github.com/VSjolund/vs-bind
const equalFn = (a, b) => a === b;
const ERROR = Symbol("error");
// Public interface
function createRoot(fn, detachedOwner) {
  detachedOwner && (Owner = detachedOwner);
  let owner = Owner,
    listener = Listener,
    root = fn.length === 0 ? UNOWNED : createComputationNode(null, null),
    result = undefined,
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
  } catch (err) {
    const fns = lookup(Owner, ERROR);
    if (!fns) throw err;
    fns.forEach(f => f(err));
  } finally {
    RootClock.afters.run(f => f());
    Listener = listener;
    Owner = owner;
  }
  return result;
}
function createSignal(value, areEqual) {
  const d = new DataNode(value);
  let setter;
  if (areEqual) {
    let age = -1;
    setter = v => {
      if (!areEqual(v, value)) {
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
function createEffect(fn, value) {
  createComputationNode(fn, value);
}
function createDependentEffect(fn, deps, defer) {
  const resolved = Array.isArray(deps) ? callAll(deps) : deps;
  defer = !!defer;
  createComputationNode(value => {
    const listener = Listener;
    resolved();
    if (defer) defer = false;
    else {
      Listener = null;
      value = fn(value);
      Listener = listener;
    }
    return value;
  });
}
function createMemo(fn, value, areEqual) {
  var node = createComputationNode(fn, value);
  node.comparator = areEqual || null;
  return () => {
    if (Listener !== null) {
      const state = node.state;
      if ((state & 7) !== 0) {
        liftComputation(node);
      }
      if (node.age === RootClock.time && state === 8) {
        throw new Error("Circular dependency.");
      }
      if ((state & 16) === 0) {
        if (node.log === null) node.log = createLog();
        logRead(node.log);
      }
    }
    return node.value;
  };
}
function batch(fn) {
  let result = undefined;
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
function sample(fn) {
  let result,
    listener = Listener;
  Listener = null;
  result = fn();
  Listener = listener;
  return result;
}
function afterEffects(fn) {
  if (RunningClock !== null) RunningClock.afters.add(fn);
  else RootClock.afters.add(fn);
}
function onCleanup(fn) {
  if (Owner === null)
    console.warn("cleanups created outside a `createRoot` or `render` will never be run");
  else if (Owner.cleanups === null) Owner.cleanups = [fn];
  else Owner.cleanups.push(fn);
}
function onError(fn) {
  if (Owner === null)
    console.warn("error handlers created outside a `createRoot` or `render` will never be run");
  else if (Owner.context === null) Owner.context = { [ERROR]: [fn] };
  else if (!Owner.context[ERROR]) Owner.context[ERROR] = [fn];
  else Owner.context[ERROR].push(fn);
}
function isListening() {
  return Listener !== null;
}
function createContext(defaultValue) {
  const id = Symbol("context");
  return { id, Provider: createProvider(id), defaultValue };
}
function useContext(context) {
  return lookup(Owner, context.id) || context.defaultValue;
}
function getContextOwner() {
  return Owner;
}
// Internal implementation
/// Graph classes and operations
class DataNode {
  constructor(value) {
    this.value = value;
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
  next(value) {
    if (RunningClock !== null) {
      if (this.pending !== NOTPENDING) {
        // value has already been set once, check for conflicts
        if (value !== this.pending) {
          throw new Error("conflicting changes: " + value + " !== " + this.pending);
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
    return value;
  }
}
function createComputationNode(fn, value) {
  const node = {
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
    console.warn("computations created outside a `createRoot` or `render` will never be disposed");
  Owner = Listener = node;
  if (RunningClock === null) {
    toplevelComputation(node);
  } else node.value = node.fn(node.value);
  if (owner && owner !== UNOWNED) {
    if (owner.owned === null) owner.owned = [node];
    else owner.owned.push(node);
  }
  Owner = owner;
  Listener = listener;
  return node;
}
function createClock() {
  return {
    time: 0,
    changes: new Queue(),
    updates: new Queue(),
    disposes: new Queue(),
    afters: new Queue()
  };
}
function createLog() {
  return {
    node1: null,
    node1slot: 0,
    nodes: null,
    nodeslots: null
  };
}
class Queue {
  constructor() {
    this.items = [];
    this.count = 0;
  }
  reset() {
    this.count = 0;
  }
  add(item) {
    this.items[this.count++] = item;
  }
  run(fn) {
    let items = this.items;
    for (let i = 0; i < this.count; i++) {
      try {
        const item = items[i];
        items[i] = null;
        fn(item);
      } catch (err) {
        const fns = lookup(Owner, ERROR);
        if (!fns) throw err;
        fns.forEach(f => f(err));
      }
    }
    this.count = 0;
  }
}
// "Globals" used to keep track of current system state
let RootClock = createClock(),
  RunningClock = null, // currently running clock
  Listener = null, // currently listening computation
  Owner = null, // owner for new computations
  Pending = null; // pending node
// Constants
let NOTPENDING = {},
  UNOWNED = createComputationNode(null, null);
// State
// 1 - Stale, 2 - Pending, 4 - Pending Disposal, 8 - Running, 16 - Disposed
// Functions
function callAll(ss) {
  return function all() {
    for (let i = 0; i < ss.length; i++) ss[i]();
  };
}
function lookup(owner, key) {
  return (
    owner && ((owner.context && owner.context[key]) || (owner.owner && lookup(owner.owner, key)))
  );
}
function resolveChildren(children) {
  if (typeof children === "function") return createMemo(() => resolveChildren(children()));
  if (Array.isArray(children)) {
    const results = [];
    for (let i = 0; i < children.length; i++) {
      let result = resolveChildren(children[i]);
      Array.isArray(result) ? results.push.apply(results, result) : results.push(result);
    }
    return results;
  }
  return children;
}
function createProvider(id) {
  return function provider(props) {
    let rendered;
    createComputationNode(() => {
      Owner.context = { [id]: props.value };
      rendered = sample(() => resolveChildren(props.children));
    });
    return rendered;
  };
}
function logRead(from) {
  let to = Listener,
    fromslot,
    toslot = to.source1 === null ? -1 : to.sources === null ? 0 : to.sources.length;
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
    from.nodeslots.push(toslot);
  }
  if (to.source1 === null) {
    to.source1 = from;
    to.source1slot = fromslot;
  } else if (to.sources === null) {
    to.sources = [from];
    to.sourceslots = [fromslot];
  } else {
    to.sources.push(from);
    to.sourceslots.push(fromslot);
  }
}
function liftComputation(node) {
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
function toplevelComputation(node) {
  RunningClock = RootClock;
  RootClock.changes.reset();
  RootClock.updates.reset();
  try {
    node.value = node.fn(node.value);
    if (RootClock.changes.count > 0 || RootClock.updates.count > 0) {
      RootClock.time++;
      run(RootClock);
    }
  } catch (err) {
    const fns = lookup(Owner, ERROR);
    if (!fns) throw err;
    fns.forEach(f => f(err));
  } finally {
    RunningClock = Owner = Listener = null;
  }
}
function run(clock) {
  let running = RunningClock,
    count = 0;
  RunningClock = clock;
  clock.disposes.reset();
  // for each batch ...
  while (clock.changes.count !== 0 || clock.updates.count !== 0 || clock.disposes.count !== 0) {
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
  clock.afters.run(f => f());
  RunningClock = running;
}
function applyDataChange(data) {
  data.value = data.pending;
  data.pending = NOTPENDING;
  if (data.log) setComputationState(data.log, stateStale);
}
function updateNode(node) {
  const state = node.state;
  if ((state & 16) === 0) {
    if ((state & 2) !== 0) {
      node.dependents[node.dependentslot++] = null;
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
function updateComputation(node) {
  const value = node.value,
    owner = Owner,
    listener = Listener;
  Owner = Listener = node;
  node.state = 8;
  cleanupNode(node, false);
  node.value = node.fn(node.value);
  resetComputation(node, 31);
  Owner = owner;
  Listener = listener;
  return value;
}
function stateStale(node) {
  const time = RootClock.time;
  if (node.age < time) {
    node.state |= 1;
    node.age = time;
    setDownstreamState(node, !!node.comparator);
  }
}
function statePending(node) {
  const time = RootClock.time;
  if (node.age < time) {
    node.state |= 2;
    let dependents = node.dependents || (node.dependents = []);
    dependents[node.dependentcount++] = Pending;
    setDownstreamState(node, true);
  }
}
function pendingStateStale(node) {
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
function setDownstreamState(node, pending) {
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
function markDownstreamComputations(node, onchange, dirty) {
  const owned = node.owned;
  if (owned !== null) {
    const pending = onchange && !dirty;
    markForDisposal(owned, pending, RootClock.time);
  }
  const log = node.log;
  if (log !== null) {
    setComputationState(log, dirty ? pendingStateStale : onchange ? statePending : stateStale);
  }
}
function setComputationState(log, stateFn) {
  const node1 = log.node1,
    nodes = log.nodes;
  if (node1 !== null) stateFn(node1);
  if (nodes !== null) {
    for (let i = 0, ln = nodes.length; i < ln; i++) {
      stateFn(nodes[i]);
    }
  }
}
function markForDisposal(children, pending, time) {
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
function applyUpstreamUpdates(node) {
  if ((node.state & 4) !== 0) {
    const owner = node.owner;
    if ((owner.state & 7) !== 0) liftComputation(owner);
    node.state &= ~4;
  }
  if ((node.state & 2) !== 0) {
    const slots = node.dependents;
    for (let i = node.dependentslot, ln = node.dependentcount; i < ln; i++) {
      const slot = slots[i];
      if (slot != null) liftComputation(slot);
      slots[i] = null;
    }
    node.state &= ~2;
  }
}
function cleanupNode(node, final) {
  let source1 = node.source1,
    sources = node.sources,
    sourceslots = node.sourceslots,
    cleanups = node.cleanups,
    owned = node.owned,
    i,
    len;
  if (cleanups !== null) {
    for (i = 0; i < cleanups.length; i++) {
      cleanups[i](final);
    }
    node.cleanups = null;
  }
  node.context = null;
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
      cleanupSource(sources.pop(), sourceslots.pop());
    }
  }
}
function cleanupSource(source, slot) {
  let nodes = source.nodes,
    nodeslots = source.nodeslots,
    last,
    lastslot;
  if (slot === -1) {
    source.node1 = null;
  } else {
    last = nodes.pop();
    lastslot = nodeslots.pop();
    if (slot !== nodes.length) {
      nodes[slot] = last;
      nodeslots[slot] = lastslot;
      if (lastslot === -1) {
        last.source1slot = slot;
      } else {
        last.sourceslots[lastslot] = slot;
      }
    }
  }
}
function resetComputation(node, flags) {
  node.state &= ~flags;
  node.dependentslot = 0;
  node.dependentcount = 0;
}
function dispose(node) {
  node.fn = null;
  node.log = null;
  node.dependents = null;
  cleanupNode(node, true);
  resetComputation(node, 31);
}

module.exports = {
  createRoot, createComputed: createEffect, createSignal
}