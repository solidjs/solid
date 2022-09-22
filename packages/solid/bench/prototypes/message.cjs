const equalFn = (a, b) => a === b;
const signalOptions = {
  equals: equalFn
};
let runEffects = runQueue;
const UNOWNED = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
var Owner = null;
let Listener = null;
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
    observers: null,
    observerSlots: null,
    comparator: options.equals || undefined
  };
  return [
    readSignal.bind(s),
    value => {
      if (typeof value === "function") {
        value = value(s.value);
      }
      if (writeSignal(s, value) && s.observers && s.observers.length) {
        runUpdates(() => {
          markDownstream(s, false, true, true);
          runImmediate(s);
        });
      }
      return value;
    }
  ];
}
function createComputed(fn, value) {
  updateComputation(createComputation(fn, value, true));
}
function createMemo(fn, value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const c = createComputation(fn, value, true);
  c.observers = null;
  c.observerSlots = null;
  c.comparator = options.equals || undefined;
  updateComputation(c);
  return readSignal.bind(c);
}

function batch(fn) {
  return runUpdates(fn);
}
function untrack(fn) {
  let result,
    listener = Listener;
  Listener = null;
  result = fn();
  Listener = listener;
  return result;
}
function readSignal() {
  if (this.sources) updateNode(this);
  if (Listener) {
    const sSlot = this.observers ? this.observers.length : 0;
    if (!Listener.sources) {
      Listener.sources = [this];
      Listener.sourceSlots = [sSlot];
    } else {
      Listener.sources.push(this);
      Listener.sourceSlots.push(sSlot);
    }
    if (!this.observers) {
      this.observers = [Listener];
      this.observerSlots = [Listener.sources.length - 1];
    } else {
      this.observers.push(Listener);
      this.observerSlots.push(Listener.sources.length - 1);
    }
  }
  return this.value;
}
function writeSignal(node, value) {
  if (node.comparator && node.comparator(node.value, value)) return;
  node.value = value;
  return true;
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
    if (node.observers && node.observers.length) {
      markDownstream(node, !writeSignal(node, nextValue));
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
  let wait = false;
  if (Effects) wait = true;
  else Effects = [];
  ExecCount++;
  try {
    const res = fn();
    completeUpdates(wait);
    return res;
  } finally {
    if (!wait) Effects = null;
  }
}
function completeUpdates(wait) {
  if (wait) return;
  const e = Effects;
  Effects = null;
  if (e.length) runUpdates(() => runEffects(e));
}
function runQueue(queue) {
  for (let i = 0; i < queue.length; i++) queue[i].stale && runTop(queue[i]);
}
function lookUpstream(node) {
  for (let i = 0; i < node.sources.length; i += 1) {
    const source = node.sources[i];
    if (source.sources) {
      if (source.stale === source.ready) runTop(source);
      else if (source.stale) lookUpstream(source);
    }
  }
}
function markDownstream(node, decrease, stale, top) {
  for (let i = 0; i < node.observers.length; i += 1) {
    const o = node.observers[i];
    if (stale) {
      if (top) o.ready++;
      !o.stale++ && o.observers && o.observers.length && markDownstream(o, false, true);
    } else if (decrease) o.stale && o.stale--;
    else o.ready++;
  }
}
function runImmediate(node) {
  if (node.observers.length === 1) {
    return runNode(node.observers[0]);
  }
  const clone = [...node.observers];
  for (let i = 0; i < clone.length; i += 1) {
    runNode(clone[i]);
  }
}
function runNode(node) {
  if (node.stale === node.ready) {
    if (node.stale) {
      if (node.pure) runTop(node);
      else Effects.push(node);
    } else if (node.observers && node.observers.length) {
      markDownstream(node, true);
      runImmediate(node);
    }
  }
}
function updateNode(node) {
  if (node.stale) {
    if (node.stale === node.ready) {
      updateComputation(node);
    } else lookUpstream(node);
  }
}
function cleanNode(node) {
  let i;
  if (node.sources) {
    while (node.sources.length) {
      const source = node.sources.pop(),
        index = node.sourceSlots.pop(),
        obs = source.observers;
      if (obs && obs.length) {
        const n = obs.pop(),
          s = source.observerSlots.pop();
        if (index < obs.length) {
          n.sourceSlots[s] = index;
          obs[index] = n;
          source.observerSlots[index] = s;
        }
      }
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

exports.createComputed = createComputed;
exports.createMemo = createMemo;
exports.createRoot = createRoot;
exports.createSignal = createSignal;
exports.batch = batch;
