let currentCollecting = null;
function setData(data, value) {
  if (!inTransaction) {
    return runInTransaction(() => setData(data, value));
  }
  if (data.value !== value) {
    data.value = value;
    data.flags |= 1024 /* Changed */;
    dirtyDataQueue.push(data); // TODO: redunant?
    markObserversMaybeStale(data);
  }
}
const dirtyDataQueue = [];
const effects = [];
function markObserversMaybeStale(computation) {
  if (computation.flags & 64 /* SingleObserver */) {
    const observer = computation.observer;
    if (observer !== null) {
      if ((observer.flags & 2048) /* Zombie */ === 0) {
        observer.depsReadyBits |= 1 << computation.observerSlot; // maximum 52 dependencies
      }
      if (observer.flags & 8 /* MaybeStale */) {
        return;
      }
      observer.flags |= 8 /* MaybeStale */;
      markObserversMaybeStale(observer);
    }
  } else {
    for (let i = 0; i < computation.observers.length; i++) {
      const observer = computation.observers[i];
      if ((observer.flags & 2048) /* Zombie */ === 0) {
        observer.depsReadyBits |= 1 << computation.observerSlots[i];
      }
      if (observer.flags & 8 /* MaybeStale */) {
        continue;
      }
      observer.flags |= 8 /* MaybeStale */;
      markObserversMaybeStale(observer);
    }
  }
}
function accessData(data) {
  if (currentCollecting !== null) {
    if (currentCollecting.flags & 256 /* Dynamic */) {
      insertNewSource(currentCollecting, data);
    } else if (currentCollecting.flags & 512 /* MaybeStable */) {
      logUnstable(currentCollecting, data);
    }
    if (data.flags & 2048 /* Zombie */) {
      if ((currentCollecting.flags & 2048) /* Zombie */ === 0) {
        data.flags -= 2048 /* Zombie */; // dezombie naturally
      }
    }
  }
  return data.value;
}
function accessComputation(data) {
  if (data.flags & 32 /* Computing */) {
    throw new Error("Circular dependency");
  }
  if (currentCollecting !== null) {
    if (currentCollecting.flags & 256 /* Dynamic */) {
      insertNewSource(currentCollecting, data);
    } else if (currentCollecting.flags & 512 /* MaybeStable */) {
      logUnstable(currentCollecting, data);
    }
    if (data.flags & 2048 /* Zombie */) {
      if ((currentCollecting.flags & 2048) /* Zombie */ === 0) {
        data.flags -= 2048 /* Zombie */; // dezombie naturally
      }
    }
  }
  if (data.flags & 8 /* MaybeStale */) {
    updateComputation(data);
    data.flags -= 8 /* MaybeStale */;
  }
  return data.value;
}
function logUnstable(accessor, data) {
  if (accessor.flags & 128 /* SingleSource */) {
    if (accessor.source !== data) {
      // currentCollecting.source is definitely not null? why?
      // deps changed
      accessor.flags -= 512 /* MaybeStable */;
      accessor.flags |= 256 /* Dynamic */;
      // clean observers from here
      if (accessor.checkIndex === 0) {
        // checkIndex == 0 means this is the first source
        // first source doesn't match?
        cleanupComputationOfSingleSource(accessor);
        // otherwise it changes from single source to multi source.
      }
      insertNewSource(accessor, data); // still need to log.
    } else {
      accessor.checkIndex++;
    }
  } else {
    const checkIndex = accessor.checkIndex;
    if (checkIndex >= accessor.sources.length || data !== accessor.sources[checkIndex]) {
      // deps changed.
      accessor.flags -= 512 /* MaybeStable */;
      accessor.flags |= 256 /* Dynamic */;
      // clean observers from here
      cleanupComputation(accessor, checkIndex);
      insertNewSource(accessor, data);
    } else {
      accessor.checkIndex++;
    }
  }
}
function collectSourceAndRecomputeComputation(computation) {
  const stored = currentCollecting;
  currentCollecting = computation;
  computation.flags |= 32 /* Computing */;
  const currentValue = computation.collect();
  computation.flags -= 32 /* Computing */;
  if (computation.flags & 512 /* MaybeStable */) {
    // check the real used deps is lesser than assumed.
    if (computation.flags & 128 /* SingleSource */) {
      if (computation.checkIndex === 0 && computation.source !== null) {
        computation.flags -= 512 /* MaybeStable */;
        computation.flags |= 256 /* Dynamic */;
        cleanupComputationOfSingleSource(computation);
      }
    } else if (computation.checkIndex != computation.sources.length) {
      computation.flags -= 512 /* MaybeStable */;
      computation.flags |= 256 /* Dynamic */;
      cleanupComputation(computation, computation.checkIndex);
    }
    currentCollecting.checkIndex = 0;
  }
  currentCollecting = stored;
  return currentValue;
}
function untrack(fn, ...args) {
  const stored = currentCollecting;
  currentCollecting = null;
  const ret = fn(...args);
  currentCollecting = stored;
  return ret;
}
function updateComputation(computation) {
  if (computation.flags & 256 /* Dynamic */) {
    cleanupComputation(computation, 0);
  }
  const currentValue = collectSourceAndRecomputeComputation(computation);
  if (computation.flags & 4096 /* NotReady */) {
    computation.flags -= 4096 /* NotReady */ | 256 /* Dynamic */;
    if (computation.flags & 16384 /* Stable */) {
      computation.flags |= 16384 /* Stable */;
    } else {
      computation.flags |= 512 /* MaybeStable */;
    }
  }
  // compare value , if changed, mark as changed
  if (currentValue !== computation.value) {
    computation.value = currentValue;
    computation.flags |= 1024 /* Changed */; // maybe problematic?
  }
}
function cleanupComputationOfSingleSource(cell) {
  if (cell.source === null) {
    return;
  }
  let theSource = cell.source;
  let observerSlotOfLastSourceOfComputation = cell.sourceSlot;
  cell.source = null;
  cell.sourceSlot = -1;
  if (theSource.flags & 64 /* SingleObserver */ && theSource.observer !== null) {
    theSource.observer = null;
    theSource.observerSlot = -1;
  } else {
    // here observers is definitely not empty:
    let lastObserverOfSource = theSource.observers.pop();
    let sourceSlotOfLastObserverOfSource = theSource.observerSlots.pop(); //我原来在哪儿，要找回去。
    if (observerSlotOfLastSourceOfComputation == theSource.observers.length) {
      // lucky, you are just the last observer
      return;
    }
    // replace you with last observer
    theSource.observers[observerSlotOfLastSourceOfComputation] = lastObserverOfSource;
    theSource.observerSlots[
      observerSlotOfLastSourceOfComputation
    ] = sourceSlotOfLastObserverOfSource;
    // notify the change of position
    if (lastObserverOfSource.flags & 128 /* SingleSource */) {
      lastObserverOfSource.sourceSlot = observerSlotOfLastSourceOfComputation;
    } else {
      lastObserverOfSource.sourceSlots[
        sourceSlotOfLastObserverOfSource
      ] = observerSlotOfLastSourceOfComputation;
    }
  }
}
function cleanupComputation(cell, remain) {
  if (cell.flags & 128 /* SingleSource */) {
    return cleanupComputationOfSingleSource(cell);
  }
  while (cell.sources.length > remain) {
    let theSource = cell.sources.pop();
    let observerSlotOfLastSourceOfComputation = cell.sourceSlots.pop();
    if (theSource.flags & 64 /* SingleObserver */ && theSource.observer !== null) {
      theSource.observer = null;
      theSource.observerSlot = -1;
    } else {
      let lastObserverOfSource = theSource.observers.pop();
      let sourceSlotOfLastObserverOfSource = theSource.observerSlots.pop();
      if (observerSlotOfLastSourceOfComputation == theSource.observers.length) {
        continue;
      }
      theSource.observers[observerSlotOfLastSourceOfComputation] = lastObserverOfSource;
      theSource.observerSlots[
        observerSlotOfLastSourceOfComputation
      ] = sourceSlotOfLastObserverOfSource;
      if (lastObserverOfSource.flags & 128 /* SingleSource */) {
        lastObserverOfSource.sourceSlot = observerSlotOfLastSourceOfComputation;
      } else {
        lastObserverOfSource.sourceSlots[
          sourceSlotOfLastObserverOfSource
        ] = observerSlotOfLastSourceOfComputation;
      }
    }
  }
}
function propagate(computation) {
  let notZombie = false;
  // if maybe stale
  if (computation.flags & 8 /* MaybeStale */) {
    if (computation.depsReadyBits !== 0) {
      throw "this should never happen.";
    }
    if (computation.flags & 4 /* Stale */) {
      updateComputation(computation);
      computation.flags -= 4 /* Stale */;
    }
    computation.flags -= 8 /* MaybeStale */;
    // now it is definitely not stale!
  }
  // if changed
  if (computation.flags & 1024 /* Changed */) {
    let hasObserver = false;
    if (computation.flags & 64 /* SingleObserver */) {
      const observer = computation.observer;
      if (observer !== null) {
        if ((observer.flags & 2048) /* Zombie */ === 0) {
          observer.flags |= 4 /* Stale */;
          observer.depsReadyBits -= 1 << computation.observerSlot;
          if (observer.depsReadyBits === 0 && propagate(observer)) {
            notZombie = true;
          }
          hasObserver = true;
        }
      }
    } else {
      for (let i = 0; i < computation.observers.length; ) {
        let current = computation.observers[i];
        if (current.flags & 2048 /* Zombie */) {
          i++;
          continue;
        }
        if ((current.flags & 8) /* MaybeStale */ === 0) {
          i++;
          hasObserver = true; // ???
          continue;
        }
        current.flags |= 4 /* Stale */;
        current.depsReadyBits -= 1 << computation.observerSlots[i];
        if (current.depsReadyBits === 0 && propagate(current)) {
          notZombie = true;
        }
        if (current === computation.observers[i]) {
          i++;
        }
        hasObserver = true;
      }
    }
    // now remove changed mark.
    computation.flags -= 1024 /* Changed */;
    if (computation.last_effect) {
      let wnode = computation.last_effect;
      while (wnode !== null) {
        effects.push(wnode.fn);
        wnode = wnode.prev;
      }
    } else if (!hasObserver) {
      computation.flags |= 2048 /* Zombie */;
    }
  } else {
    if (computation.flags & 64 /* SingleObserver */) {
      if (computation.observer !== null) {
        // TODO: make inline cache?
        if (!((computation.observer.flags & 2048) /* Zombie */)) {
          computation.observer.depsReadyBits -= 1 << computation.observerSlot;
          if (computation.observer.depsReadyBits === 0 && propagate(computation.observer)) {
            notZombie = true;
          }
        }
      }
    } else {
      for (let i = 0; i < computation.observers.length; i++) {
        let current = computation.observers[i];
        if (current.flags & 2048 /* Zombie */) {
          continue;
        }
        current.depsReadyBits -= 1 << computation.observerSlots[i];
        if (current.depsReadyBits === 0 && propagate(current)) {
          notZombie = true;
        }
      }
    }
  }
  return notZombie;
}
function watch(data, sideEffect) {
  if (data.flags & 2048 /* Zombie */) {
    data.flags -= 2048 /* Zombie */;
  }
  if (data.flags & 1 /* Data */) {
    accessData(data); // TODO: is it necessary?
  } else {
    accessComputation(data); // because it maybe stale?
  }
  const node = {
    fn: sideEffect,
    prev: data.last_effect,
    next: null,
    disposed: false,
    data: data
  };
  if (data.last_effect) {
    data.last_effect.next = node;
  }
  data.last_effect = node;
  return node;
}
function disposeWatcher(watcher) {
  if (watcher.disposed) {
    return;
  }
  watcher.disposed = true;
  if (watcher.next === null) {
    // it is the last.
    watcher.data.last_effect = watcher.prev;
  } else {
    watcher.next.prev = watcher.prev;
  }
  if (watcher.prev) {
    watcher.prev.next = watcher.next;
  }
}
let inTransaction = false;
function runInTransaction(fn) {
  if (inTransaction) {
    // already inside a transaction
    return fn();
  }
  inTransaction = true;
  const retValue = fn();
  inTransaction = false;
  while (dirtyDataQueue.length) {
    const data = dirtyDataQueue.pop();
    propagate(data);
  }
  while (effects.length) {
    effects.pop()();
  }
  return retValue;
}
function insertNewSource(accessing, source) {
  if (accessing.flags & 128 /* SingleSource */) {
    if (accessing.source === null) {
      accessing.source = source;
      accessing.sourceSlot = insertNewObserver(source, accessing, -1);
    } else {
      accessing.flags -= 128 /* SingleSource */;
      // notify relocation
      if (accessing.source.flags & 64 /* SingleObserver */) {
        accessing.source.observerSlot = 0;
      } else {
        accessing.source.observerSlots[accessing.sourceSlot] = 0;
      }
      accessing.sources = [accessing.source];
      accessing.sourceSlots = [accessing.sourceSlot];
      accessing.source = null;
      accessing.sourceSlot = -1;
      return insertNewSource(accessing, source);
    }
  } else {
    accessing.sources.push(source);
    accessing.sourceSlots.push(insertNewObserver(source, accessing, accessing.sourceSlots.length));
  }
}
function insertNewObserver(accesed, observer, atWhichSlotOfObserver) {
  if (accesed.flags & 64 /* SingleObserver */) {
    if (accesed.observer === null) {
      accesed.observer = observer;
      accesed.observerSlot = atWhichSlotOfObserver;
      return -1;
    } else {
      accesed.flags -= 64 /* SingleObserver */;
      if (accesed.observer.flags & 128 /* SingleSource */) {
        accesed.observer.sourceSlot = 0;
      } else {
        accesed.observer.sourceSlots[accesed.observerSlot] = 0;
      }
      accesed.observers = [accesed.observer];
      accesed.observerSlots = [accesed.observerSlot];
      accesed.observer = null;
      accesed.observerSlot = -1;
      return insertNewObserver(accesed, observer, atWhichSlotOfObserver);
    }
  } else {
    accesed.observers.push(observer);
    accesed.observerSlots.push(atWhichSlotOfObserver);
    return accesed.observerSlots.length - 1;
  }
}
function createData(value) {
  return {
    flags: 1 /* Data */ | 64 /* SingleObserver */ | 2048 /* Zombie */,
    last_effect: null,
    observer: null,
    observerSlot: -1,
    observers: null,
    observerSlots: null,
    value
  };
}
function createComputation(fn, options) {
  const ret = {
    flags:
      2 /* Computation */ |
      128 /* SingleSource */ |
      64 /* SingleObserver */ |
      2048 /* Zombie */ |
      8 /* MaybeStale */ |
      256 /* Dynamic */ |
      4096 /* NotReady */,
    last_effect: null,
    observer: null,
    observerSlot: -1,
    observers: null,
    observerSlots: null,
    value: null,
    source: null,
    sourceSlot: -1,
    sources: null,
    sourceSlots: null,
    collect: fn,
    depsReadyBits: 0,
    checkIndex: 0
  };
  // ret.value = collectSourceAndRecomputeComputation(ret);
  if (options === null || options === void 0 ? void 0 : options.static) {
    // if source is ready: give it ready.
    ret.flags |= 16384 /* Stable */;
  }
  return ret;
}

module.exports = {
  createRoot: fn => fn(),
  createSignal: value => {
    const node = createData(value);
    return [() => accessData(node), v => setData(node, v)];
  },
  createComputed: fn => {
    const g = createComputation(fn);
    watch(g, () => {});
  }
};
