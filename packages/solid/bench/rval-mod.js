const NOT_TRACKING = 0;
const STALE = 1;
const UP_TO_DATE = 2;

const context = {
  isUpdating: false,
  pending: [],
  currentlyComputingStack: [],
  get currentlyComputing() {
    return this.currentlyComputingStack[this.currentlyComputingStack.length - 1];
  },
  isRunningReactions: false,
  runPendingObservers
};

function freeze(fn) {
  if (context.isUpdating) return fn();
  try {
    context.isUpdating = true;
    return fn();
  } finally {
    context.isUpdating = false;
    runPendingObservers();
  }
}
function runPendingObservers() {
  if (!context.isUpdating && !context.isRunningReactions) {
    context.isRunningReactions = true;
    while (context.pending.length) {
      // N.B. errors here cause other pending subscriptions to be aborted!
      const fns = context.pending.splice(0);
      for (let i = 0, len = fns.length; i < len; i += 1) fns[i]();
    }
    context.isRunningReactions = false;
  }
}

class Signal {
  constructor(state) {
    this.listeners = new Set();
    this.value = state;
  }
  addListener(listener) {
    this.listeners.add(listener);
  }
  removeListener(listener) {
    this.listeners.delete(listener);
  }
  get() {
    return registerRead(this);
  }
  set(newValue) {
    if (newValue !== this.value) {
      this.value = newValue;
      freeze(() => runAll(this.listeners));
    }
  }
}
class Computed {
  constructor(derivation) {
    this.derivation = derivation;
    this.listeners = new Set();
    this.inputValues = undefined;
    this.observing = new Set();
    this.state = NOT_TRACKING;
    this.dirtyCount = 0;
    this.value = undefined;
    this.markDirty = () => {
      if (++this.dirtyCount === 1) {
        this.state = STALE;
        runAll(this.listeners);
      }
    };
  }
  addListener(observer) {
    this.listeners.add(observer);
  }
  removeListener(observer) {
    this.listeners.delete(observer)
  }
  registerDependency(sub) {
    this.observing.add(sub);
  }
  someDependencyHasChanged() {
    switch (this.state) {
      case NOT_TRACKING:
        return true;
      case UP_TO_DATE:
        return false;
      case STALE:
        if (!inputSetHasChanged(this.observing, this.inputValues)) {
          this.dirtyCount = 0;
          this.state = UP_TO_DATE;
          return false;
        }
    }
    return true;
  }
  track() {
    if (!this.someDependencyHasChanged()) return;
    const oldObserving = this.observing;
    const [newValue, newObserving] = track(this.derivation);
    this.value = newValue;
    this.observing = newObserving;
    registerDependencies(this.markDirty, oldObserving, newObserving);
    this.inputValues = recordInputSet(newObserving);
    this.dirtyCount = 0;
    this.state = UP_TO_DATE;
  }
  get() {
    registerRead(this);
    // yay, we are up to date!
    if (this.state === UP_TO_DATE) return this.value;
    // nope, we are not, and no one is observing either
    if (!context.currentlyComputing && !this.listeners.size) {
      // This won't actively remove any listener, but will transition the drv to
      // untracked, if no other listener arrived
      // TODO: optimize: have one handler for this!
      // TODO: should there be an option to disable this optimization to prevent mem leaking?
      setTimeout(() => this.removeListener(null), 0);
    }
    // maybe scheduled, definitely tracking, value is needed, track now!
    this.track();
    return this.value;
  }
}
function track(fn) {
  const observing = new Set();
  context.currentlyComputingStack.push(observing);
  const res = fn();
  context.currentlyComputingStack.pop();
  return [res, observing];
}
function registerDependencies(listener, oldDeps, newDeps) {
  // Optimize:
  if (!oldDeps) {
    for (const d of newDeps.values()) d.addListener(listener);
  } else {
    for (const o of newDeps.values()) {
      if (!oldDeps.has(o)) o.addListener(listener);
    }
    for (const o of oldDeps) {
      if (!newDeps.has(o)) o.removeListener(listener);
    }
  }
}
function registerRead(observable) {
  if (context.currentlyComputing) context.currentlyComputing.add(observable);
  return observable.value;
}
function recordInputSet(deps) {
  // optimize: write more efficiently
  return [...deps].map(currentValue);
}
function inputSetHasChanged(deps, inputs) {
  return !deps || !inputs || ![...deps.values()].every((o, idx) => o.get() === inputs[idx]);
}
function currentValue(dep) {
  // Returns the current, last known (computed) value of a dep
  // Regardless whether that is stale or not
  return dep.value;
}
function runAll(fns) {
  for (const fn of fns.values()) fn();
}

function createSignal(value) {
  const v = new Signal(value);
  return [v.get.bind(v), v.set.bind(v)];
}

function createMemo(derivation) {
  const c = new Computed(derivation);
  return c.get.bind(c);
}

function createRoot(fn) {
  fn();
}

function createEffect(fn) {
  const computed = new Computed(fn);
  let scheduled = true;
  let disposed = false;
  function onDirty() {
    if (scheduled || disposed) return;
    scheduled = true;
    context.pending.push(onInvalidate);
  }
  function onInvalidate() {
    scheduled = false;
    computed.someDependencyHasChanged() && computed.get();
  }
  computed.addListener(onDirty);
  onInvalidate();
}

module.exports = {
  createSignal,
  createRoot,
  createEffect,
  createMemo,
  freeze
};
