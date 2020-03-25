function getChildrenDeep(children, res) {
  for (let i = 0; i < children.length; i += 1) {
    res.push(children[i]);
    getChildrenDeep(children[0]._children, res);
  }
}

const EMPTY_ARR = [];
let tracking;
let queue;

/**
 * Returns true if there is an active observer.
 * @return {boolean}
 */
function isListening() {
  return !!tracking;
}

/**
 * Creates a root and executes the passed function that can contain computations.
 * The executed function receives an `unsubscribe` argument which can be called to
 * unsubscribe all inner computations.
 *
 * @param  {Function} fn
 * @return {*}
 */
function createRoot(fn) {
  const prevTracking = tracking,
    rootUpdate = { _children: [] };
  tracking = rootUpdate;
  const result = fn(() => {
    _unsubscribe(rootUpdate);
    tracking = undefined;
  });
  tracking = prevTracking;
  return result;
}

function sample(fn) {
  const prevTracking = tracking;
  tracking = undefined;
  const value = fn();
  tracking = prevTracking;
  return value;
}

function freeze(fn) {
  let prevQueue = queue;
  queue = [];
  const result = fn();
  let q = queue;
  queue = prevQueue;
  for (let i = 0; i < q.length; i += 1) {
    const data = q[i];
    if (data._pending !== EMPTY_ARR) {
      const pending = data._pending;
      data._pending = EMPTY_ARR;
      data(pending);
    }
  }
  return result;
}

class DataNode {
  constructor(value) {
    this._observers = new Set();
    this._pending = EMPTY_ARR;
    this.value = value;
    this._runObservers = null;
  }
  current() {
    if (tracking && tracking._observables && !this._observers.has(tracking)) {
      this._observers.add(tracking);
      tracking._observables.push(this);
    }
    return this.value;
  }
  next(nextValue) {
    if (queue) {
      if (this._pending === EMPTY_ARR) {
        queue.push(this);
      }
      this._pending = nextValue;
      return nextValue;
    }

    this.value = nextValue;

    // Clear `tracking` otherwise a computed triggered by a set
    // in another computed is seen as a child of that other computed.
    const clearedUpdate = tracking;
    tracking = undefined;

    // Update can alter data._observers, make a copy before running.
    this._runObservers = new Set(this._observers);
    for (const v of this._runObservers.values()) v._fresh = false;
    for (const v of this._runObservers.values()) !v._fresh && updateComputation(v);

    tracking = clearedUpdate;
    return this.value;
  }
}

function createComputationNode(observer, value) {
  const c = {
    observer,
    value,
    _fresh: false,
    _observables: [],
    _children: [],
    _cleanups: []
  };
  updateComputation(c);
  return c;
}

function removeFreshChildren(u) {
  if (u._fresh) {
    for (let i = 0, len = u._observables.length; i < len; i += 1) {
      const o = u._observables[i];
      o._runObservers && o._runObservers.delete(u);
    }
  }
}

function onCleanup(fn) {
  if (tracking) {
    tracking._cleanups.push(fn);
  }
  return fn;
}

function _unsubscribe(node) {
  let i;
  for (i = 0; i < node._children.length; i += 1) _unsubscribe(node._children[i]);
  for (i = 0; i < node._observables.length; i += 1) {
    const o = node._observables[i];
    o._observers.delete(node);
    o._runObservers && o._runObservers.delete(node);
  }
  for (i = 0; i < node._cleanups.length; i += 1) node._cleanups[i]();
  resetUpdate(node);
}

function updateComputation(node) {
  if (!node.observer) return;
  const prevTracking = tracking;
  if (tracking) {
    tracking._children.push(node);
  }

  const prevChildren = node._children;

  _unsubscribe(node);
  node._fresh = true;
  tracking = node;
  node.value = node.observer(node.value);

  // If any children computations were removed mark them as fresh.
  // Check the diff of the children list between pre and post update.
  const pK = Object.keys(prevChildren);
  for (let i = 0, len = pK.length; i < len; i += 1) {
    const u = prevChildren[i];
    if (node._children.indexOf(u) === -1) {
      u._fresh = true;
    }
  }

  // If any children were marked as fresh remove them from the run lists.
  const allChildren = [];
  getChildrenDeep(node._children, allChildren);
  for (let i = 0; i < allChildren.length; i += 1) removeFreshChildren(allChildren[i]);

  tracking = prevTracking;
  return node.value;
}

function currentValue() {
  if (this._fresh) {
    for (let i = 0; i < this._observables.length; i += 1) this._observables[i].current();
  } else {
    this.value = updateComputation(this);
  }
  return this.value;
}

function resetUpdate(node) {
  // Keep track of which observables trigger nodes. Needed for unsubscribe.
  node._observables = [];
  node._children = [];
  node._cleanups = [];
}

module.exports = {
  createSignal: value => {
    const o = new DataNode(value);
    return [o.current.bind(o), o.next.bind(o)];
  },
  createRoot,
  createEffect: (observer, seed) => createComputationNode(observer, seed),
  createMemo: (observer, seed) => {
    const c = createComputationNode(observer, seed);
    return currentValue.bind(c);
  }
};
