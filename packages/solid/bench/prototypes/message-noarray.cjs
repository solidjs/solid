const equalFn = (a, b) => a === b;
const signalOptions = {
  equals: equalFn
};
let runEffects = runQueue;
const NOTPENDING = {};
const UNOWNED = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
var Owner = null;
let Listener = null;
let Pending = null;
let Effects = null;
let ExecCount = 0;
function createRoot(fn, detachedOwner) {
  detachedOwner && (Owner = detachedOwner);
  const listener = Listener,
    owner = Owner,
    root =
      fn.length === 0 && !false
        ? UNOWNED
        : {
            owned: null,
            cleanups: null,
            context: null,
            owner
          };
  Owner = root;
  Listener = null;
  let result;
  try {
    runUpdates(() => (result = fn(() => cleanNode(root))));
  } finally {
    Listener = listener;
    Owner = owner;
  }
  return result;
}
function createSignal(value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const s = {
    value,
    observer: null,
    observerSlot: 0,
    observers: null,
    observerSlots: null,
    pending: NOTPENDING,
    comparator: options.equals || undefined
  };
  return [
    () => {
      if (Listener !== null) logRead(s);
      return s.value;
    },
    value => {
      if (typeof value === "function") {
        value = value(s.pending !== NOTPENDING ? s.pending : s.value);
      }
      if (writeSignal(s, value) && (s.observer || s.observers)) {
        markUpstream(s, false, true, true);
        runUpdates(() => runImmediate(s));
      }
      return value;
    }
  ];
}
function createComputed(fn, value) {
  updateComputation(createComputation(fn, value, true), true);
}
function createMemo(fn, value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const c = createComputation(fn, value, true);
  c.observer = null;
  c.observerSlot = 0;
  c.observers = null;
  c.observerSlots = null;
  c.comparator = options.equals || undefined;
  updateComputation(c);
  return () => {
    if (c.source) updateNode(c);
    if (Listener !== null) logRead(c);
    return c.value;
  };
}

function batch(fn) {
  if (Pending) return fn();
  let result;
  const q = (Pending = []);
  try {
    result = fn();
  } finally {
    Pending = null;
  }
  if (q.length) {
    let update = false;
    for (let i = 0; i < q.length; i += 1) {
      const node = q[i];
      if (node.pending !== NOTPENDING) {
        const pending = node.pending;
        node.pending = NOTPENDING;
        if (writeSignal(node, pending) && (node.observer || node.observers)) {
          update = true;
          markUpstream(node, false, true, true);
        } else q[i] = null;
      }
    }
    update && runUpdates(() => {
      for (let i = 0; i < q.length; i += 1) q[i] && runImmediate(q[i]);
    });
  }
  return result;
}
function untrack(fn) {
  let result,
    listener = Listener;
  Listener = null;
  result = fn();
  Listener = listener;
  return result;
}
function logRead(node) {
  let to = Listener,
    fromslot,
    toslot = to.source === null ? -1 : to.sources === null ? 0 : to.sources.length;
  if (node.observer === null) {
    node.observer = to;
    node.observerSlot = toslot;
    fromslot = -1;
  } else if (node.observerSlots === null) {
    if (node.observer === to) return node.value;
    node.observers = [to];
    node.observerSlots = [toslot];
    fromslot = 0;
  } else {
    fromslot = node.observerSlots.length;
    node.observers.push(to);
    node.observerSlots.push(toslot);
  }
  if (to.source === null) {
    to.source = node;
    to.sourceSlot = fromslot;
  } else if (to.sources === null) {
    to.sources = [node];
    to.sourceSlots = [fromslot];
  } else {
    to.sources.push(node);
    to.sourceSlots.push(fromslot);
  }
}
function writeSignal(node, value) {
  if (Pending) {
    if (node.pending === NOTPENDING) Pending.push(node);
    node.pending = value;
    return;
  }
  if (node.comparator && node.comparator(node.value, value)) return;
  node.value = value;
  return true;
}
function updateComputation(node, init) {
  if (!node.fn) return;
  cleanNode(node);
  const owner = Owner,
    listener = Listener,
    time = ExecCount;
  Listener = Owner = node;
  runComputation(node, node.value, time, init);
  Listener = listener;
  Owner = owner;
}
function runComputation(node, value, time, init) {
  let nextValue;
  if (!init && node.pure && !("observer" in node)) nextValue = batch(() => node.fn(value));
  else nextValue = node.fn(value);
  if (!node.updatedAt || node.updatedAt <= time) {
    if (node.observer || (node.observers && node.observers.length)) {
      markUpstream(node, !writeSignal(node, nextValue));
      runImmediate(node);
    } else node.value = nextValue;
    node.updatedAt = time;
  }
}
function createComputation(fn, init, pure, options) {
  const c = {
    fn,
    stale: 0,
    ready: 0,
    updatedAt: 0,
    owned: null,
    source: null,
    sourceSlot: 0,
    sources: null,
    sourceSlots: null,
    cleanups: null,
    value: init,
    owner: Owner,
    context: null,
    pure
  };
  if (Owner === null);
  else if (Owner !== UNOWNED) {
    if (!Owner.owned) Owner.owned = [c];
    else Owner.owned.push(c);
  }
  return c;
}
function runTop(node) {
  let ancestors = node;
  while ((node = node.owner) && (!node.updatedAt || node.updatedAt < ExecCount)) {
    if (node.stale) {
      if (!ancestors.length) ancestors = [node];
      ancestors.push(node);
    }
  }
  if (!ancestors.length) return updateNode(ancestors);
  for (let i = ancestors.length - 1; i >= 0; i--) {
    updateNode(ancestors[i]);
  }
}
function runUpdates(fn) {
  ExecCount++;
  if (Effects) return fn();
  Effects = [];
  try {
    fn();
  } finally {
    completeUpdates();
  }
}
function completeUpdates() {
  if (Effects.length) {
    batch(() => {
      runEffects(Effects);
      Effects = null;
    });
  } else Effects = null;
}
function runQueue(queue) {
  for (let i = 0; i < queue.length; i++) queue[i].stale && runTop(queue[i]);
}
function lookDownstream(node) {
  if (node.source) {
    lookDownstreamNode(node.source);
  }
  if (node.sources) {
    for (let i = 0; i < node.sources.length; i += 1) {
      lookDownstreamNode(node.sources[i]);
    }
  }
}
function lookDownstreamNode(node) {
  if (node.source || node.sources) {
    if (node.stale === node.ready) runTop(node);
    else if (node.stale) lookDownstream(node);
  }
}
function markUpstream(node, decrease, stale, top) {
  if (node.observer) {
    markUpstreamNode(node.observer, decrease, stale, top);
  }
  if (node.observers) {
    for (let i = 0; i < node.observers.length; i += 1) {
      markUpstreamNode(node.observers[i], decrease, stale, top);
    }
  }
}
function markUpstreamNode(o, decrease, stale, top) {
  if (stale) {
    if (top) o.ready++;
    !o.stale++ && (o.observer || o.observers) && markUpstream(o, false, true);
  } else if (decrease) o.stale && o.stale--;
  else if (o.stale) o.ready++;
}
function runImmediate(node) {
  let observers;
  if (node.observers && node.observers.length) observers = [...node.observers];
  if (node.observer) runNode(node.observer);
  if (observers) {
    for (let i = 0; i < observers.length; i += 1) {
      runNode(observers[i]);
    }
  }
}
function runNode(node) {
  if (node.stale === node.ready && node.updatedAt < ExecCount) {
    if (node.stale) {
      if (node.pure) runTop(node);
      else Effects.push(node);
    } else if (node.observer || (node.observers && node.observers.length)) {
      markUpstream(node, true);
      runImmediate(node);
    }
  }
}
function updateNode(node) {
  if (node.stale) {
    if (node.stale === node.ready) {
      updateComputation(node);
    } else lookDownstream(node);
  }
}
function cleanNode(node) {
  let i;
  if (node.source != null) {
    cleanupSource(node.source, node.sourceSlot);
    node.source = null;
  }
  if (node.sources != null) {
    for (let i = 0, len = node.sources.length; i < len; i++) {
      cleanupSource(node.sources.pop(), node.sourceSlots.pop());
    }
  }
  if (node.owned) {
    for (i = 0; i < node.owned.length; i++) cleanNode(node.owned[i]);
    node.owned = null;
  }
  if (node.cleanups) {
    for (i = 0; i < node.cleanups.length; i++) node.cleanups[i]();
    node.cleanups = null;
  }
  node.stale = node.ready = 0;
  node.context = null;
}

function cleanupSource(source, slot) {
  let nodes = source.observers,
    nodeslots = source.observerSlots,
    last,
    lastslot;
  if (slot === -1) {
    source.observer = null;
  } else {
    last = nodes.pop();
    lastslot = nodeslots.pop();
    if (slot !== nodes.length) {
      nodes[slot] = last;
      nodeslots[slot] = lastslot;
      if (lastslot === -1) {
        last.sourceSlot = slot;
      } else {
        last.sourceSlots[lastslot] = slot;
      }
    }
  }
}

exports.createComputed = createComputed;
exports.createMemo = createMemo;
exports.createRoot = createRoot;
exports.createSignal = createSignal;
exports.batch = batch;
