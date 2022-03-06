const equalFn = (a, b) => a === b;
const signalOptions = {
  equals: equalFn
};
let ERROR = null;
let runEffects = runQueue;
const NOTPENDING = {};
const STALE = 1;
const PENDING = 2;
const UNOWNED = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
var Owner = null;
let Listener = null;
let Pending = null;
let Updates = null;
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
    runUpdates(() => (result = fn(() => cleanNode(root))), true);
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
      if (Listener) logRead(s);
      return s.value;
    },
    value => {
      if (typeof value === "function") {
        value = value(s.pending !== NOTPENDING ? s.pending : s.value);
      }
      return writeSignal(s, value);
    }
  ];
}
function createComputed(fn, value) {
  updateComputation(createComputation(fn, value, true, STALE));
}
function createMemo(fn, value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const c = createComputation(fn, value, true, 0);
  c.pending = NOTPENDING;
  c.observer = null;
  c.observerSlot = 0;
  c.observers = null;
  c.observerSlots = null;
  c.comparator = options.equals || undefined;
  updateComputation(c);
  return () => {
    if (c.state && (c.source || c.sources)) {
      const updates = Updates;
      Updates = null;
      c.state === STALE ? updateComputation(c) : lookDownstream(c);
      Updates = updates;
    }
    if (Listener) logRead(c);
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
  runUpdates(() => {
    for (let i = 0; i < q.length; i += 1) {
      const data = q[i];
      if (data.pending !== NOTPENDING) {
        const pending = data.pending;
        data.pending = NOTPENDING;
        writeSignal(data, pending);
      }
    }
  }, false);
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
  if (node.comparator) {
    if (node.comparator(node.value, value)) return value;
  }
  if (Pending) {
    if (node.pending === NOTPENDING) Pending.push(node);
    node.pending = value;
    return value;
  }
  node.value = value;
  if (node.observer || (node.observers && node.observers.length)) {
    runUpdates(() => {
      if (node.observer) queueUpdates(node.observer);
      if (node.observers) {
        for (let i = 0; i < node.observers.length; i += 1) queueUpdates(node.observers[i]);
      }
      if (Updates.length > 10e5) {
        Updates = [];
        throw new Error();
      }
    }, false);
  }
  return value;
}
function queueUpdates(o) {
  if (!o.state) {
    if (o.pure) Updates.push(o);
    else Effects.push(o);
    if (o.observer || o.observers) markUpstream(o);
  }
  o.state = STALE;
}

function updateComputation(node) {
  if (!node.fn) return;
  cleanNode(node);
  const owner = Owner,
    listener = Listener,
    time = ExecCount;
  Listener = Owner = node;
  runComputation(node, node.value, time);
  Listener = listener;
  Owner = owner;
}
function runComputation(node, value, time) {
  let nextValue;
  nextValue = node.fn(value);
  if (!node.updatedAt || node.updatedAt <= time) {
    if (node.observer || (node.observers && node.observers.length)) {
      writeSignal(node, nextValue);
    } else node.value = nextValue;
    node.updatedAt = time;
  }
}
function createComputation(fn, init, pure, state = STALE, options) {
  const c = {
    fn,
    state: state,
    updatedAt: null,
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
  if (node.state === 0) return;
  if (node.state === PENDING) return lookDownstream(node);
  const ancestors = [node];
  while ((node = node.owner) && (!node.updatedAt || node.updatedAt < ExecCount)) {
    if (node.state) ancestors.push(node);
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    node = ancestors[i];
    if (node.state === STALE) {
      updateComputation(node);
    } else if (node.state === PENDING) {
      const updates = Updates;
      Updates = null;
      lookDownstream(node);
      Updates = updates;
    }
  }
}
function runUpdates(fn, init) {
  if (Updates) return fn();
  let wait = false;
  if (!init) Updates = [];
  if (Effects) wait = true;
  else Effects = [];
  ExecCount++;
  try {
    fn();
  } finally {
    completeUpdates(wait);
  }
}
function completeUpdates(wait) {
  if (Updates) {
    runQueue(Updates);
    Updates = null;
  }
  if (wait) return;
  if (Effects.length)
    batch(() => {
      runEffects(Effects);
      Effects = null;
    });
  else {
    Effects = null;
  }
}
function runQueue(queue) {
  for (let i = 0; i < queue.length; i++) runTop(queue[i]);
}
function lookDownstream(node) {
  node.state = 0;
  if (node.source) lookDownstreamNode(node.source)
  if (node.sources) {
    for (let i = 0; i < node.sources.length; i += 1) {
      lookDownstream(node.sources[i]);
    }
  }
}
function lookDownstreamNode(source) {
  if (source.source || source.sources) {
    if (source.state === STALE) runTop(source);
    else if (source.state === PENDING) lookDownstream(source);
  }
}
function markUpstream(node) {
  if (node.observer) markUpstreamNode(node.observer);
  if (node.observers) {
    for (let i = 0; i < node.observers.length; i += 1) markUpstreamNode(node.observers[i]);
  }
}
function markUpstreamNode(o) {
  if (!o.state) {
    o.state = PENDING;
    if (o.pure) Updates.push(o);
    else Effects.push(o);
    (o.observer || o.observers) && markUpstream(o);
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
  node.state = 0;
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
