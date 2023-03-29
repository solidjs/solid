import type {
  Callable,
  Computation,
  MemoOptions,
  Dispose,
  MaybeDisposable,
  Owner,
} from "./types";

let scheduledEffects = false,
  runningEffects = false,
  currentOwner: Owner | null = null,
  currentObserver: Computation | null = null,
  currentObservers: Computation[] | null = null,
  currentObserversIndex = 0,
  effects: Computation[] = [];

const HANDLER = Symbol(__DEV__ ? "ERROR_HANDLER" : 0),
  // For more information about this graph tracking scheme see Reactively:
  // https://github.com/modderme123/reactively/blob/main/packages/core/src/core.ts#L21
  STATE_CLEAN = 0,
  STATE_CHECK = 1,
  STATE_DIRTY = 2,
  STATE_DISPOSED = 3;

function flushEffects() {
  scheduledEffects = true;
  queueMicrotask(runEffects);
}

function runTop(node: Computation<any>) {
  let ancestors = [node];
  while ((node = node._parent as Computation<any>)) {
    if (node._state !== STATE_CLEAN) {
      ancestors.push(node);
    }
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    updateIfNecessary(ancestors[i]);
  }
}

function runEffects() {
  if (!effects.length) {
    scheduledEffects = false;
    return;
  }

  runningEffects = true;

  for (let i = 0; i < effects.length; i++) {
    if (effects[i]._state !== STATE_CLEAN) {
      runTop(effects[i]);
    }
  }

  effects = [];
  scheduledEffects = false;
  runningEffects = false;
}

/**
 * Creates a computation root which is given a `dispose()` function to dispose of all inner
 * computations.
 *
 * @see {@link https://github.com/solidjs/x-reactivity#createroot}
 */
export function createRoot<T>(init: (dispose: Dispose) => T): T {
  const owner = new OwnerNode();
  return compute(
    owner,
    !init.length ? init : init.bind(null, dispose.bind(owner)),
    null
  ) as T;
}

/**
 * Returns the current value stored inside the given compute function without triggering any
 * dependencies. Use `untrack` if you want to also disable owner tracking.
 *
 * @see {@link https://github.com/solidjs/x-reactivity#untrack}
 */
export function untrack<T>(fn: () => T): T {
  if (currentObserver === null) return fn();
  return compute<T>(currentOwner, fn, null);
}

/**
 * By default, signal updates are batched on the microtask queue which is an async process. You can
 * flush the queue synchronously to get the latest updates by calling `tick()`.
 *
 * @see {@link https://github.com/solidjs/x-reactivity#tick}
 */
export function flushSync(): void {
  if (!runningEffects) runEffects();
}

/**
 * Returns the currently executing parent owner.
 *
 * @see {@link https://github.com/solidjs/x-reactivity#getowner}
 */
export function getOwner(): Owner | null {
  return currentOwner;
}

/** @internal */
export function getObserver() {
  return currentObserver;
}

/**
 * Runs the given function in the given owner so context and error handling continue to work.
 *
 * @see {@link https://github.com/solidjs/x-reactivity#runwithowner}
 */
export function runWithOwner<T>(
  owner: Owner | null,
  run: () => T
): T | undefined {
  try {
    return compute<T>(owner, run, null);
  } catch (error) {
    handleError(owner, error);
  }
}

/**
 * Runs the given function when an error is thrown in a child owner. If the error is thrown again
 * inside the error handler, it will trigger the next available parent owner handler.
 *
 * @see {@link https://github.com/solidjs/x-reactivity#catcherror}
 */
export function catchError<T, U = Error>(
  fn: () => T,
  handler: (error: U) => void
): void {
  const owner = new OwnerNode();
  owner._context = { [HANDLER]: handler };
  try {
    compute(owner, fn, null);
  } catch (error) {
    handleError(owner, error);
  }
}

/**
 * Runs the given function when the parent owner computation is being disposed.
 *
 * @see {@link https://github.com/solidjs/x-reactivity#ondispose}
 */
export function onCleanup(disposable: MaybeDisposable): void {
  if (!disposable || !currentOwner) return;

  const node = currentOwner;

  if (!node._disposal) {
    node._disposal = disposable;
  } else if (Array.isArray(node._disposal)) {
    node._disposal.push(disposable);
  } else {
    node._disposal = [node._disposal, disposable];
  }
}

export function dispose(this: Owner, self = true) {
  if (this._state === STATE_DISPOSED) return;

  let head = self ? this._prevSibling : this,
    current = this._nextSibling as Computation | null;

  while (current && current._parent === this) {
    dispose.call(current, true);
    disposeNode(current);
    current = current._nextSibling as Computation;
  }

  if (self) disposeNode(this as Computation);
  if (current) current._prevSibling = !self ? this : this._prevSibling;
  if (head) head._nextSibling = current;
}

function disposeNode(node: Computation) {
  node._state = STATE_DISPOSED;
  if (node._disposal) emptyDisposal(node);
  if (node._sources) removeSourceObservers(node, 0);
  if (node._prevSibling) node._prevSibling._nextSibling = null;
  node._parent = null;
  node._sources = null;
  node._observers = null;
  node._prevSibling = null;
  node._context = null;
}

function emptyDisposal(owner: Computation) {
  if (Array.isArray(owner._disposal)) {
    for (let i = 0; i < owner._disposal.length; i++) {
      const callable = owner._disposal![i];
      callable.call(callable);
    }
  } else {
    owner._disposal!.call(owner._disposal);
  }

  owner._disposal = null;
}

export function compute<Result>(
  owner: Owner | null,
  compute: Callable<Owner | null, Result>,
  observer: Computation | null
): Result {
  const prevOwner = currentOwner,
    prevObserver = currentObserver;

  currentOwner = owner;
  currentObserver = observer;

  try {
    return compute.call(owner, observer ? observer._value : undefined);
  } finally {
    currentOwner = prevOwner;
    currentObserver = prevObserver;
  }
}

function lookup(owner: Owner | null, key: string | symbol): any {
  if (!owner) return;

  let current: Owner | null = owner,
    value;

  while (current) {
    value = current._context?.[key];
    if (value !== undefined) return value;
    current = current._parent;
  }
}

function handleError(owner: Owner | null, error: unknown) {
  const handler = lookup(owner, HANDLER);

  if (!handler) throw error;

  try {
    const coercedError =
      error instanceof Error ? error : Error(JSON.stringify(error));
    handler(coercedError);
  } catch (error) {
    handleError(owner!._parent, error);
  }
}

export function read(this: Computation): any {
  if (this._state === STATE_DISPOSED) return this._value;

  if (currentObserver && !this._effect) {
    if (
      !currentObservers &&
      currentObserver._sources &&
      currentObserver._sources[currentObserversIndex] == this
    ) {
      currentObserversIndex++;
    } else if (!currentObservers) currentObservers = [this];
    else currentObservers.push(this);
  }

  if (this._compute) updateIfNecessary(this);

  return this._value;
}

export function write(this: Computation, newValue: any): any {
  const value = isFunction(newValue) ? newValue(this._value) : newValue;

  if (!this._equals || !this._equals(this._value, value)) {
    this._value = value;
    if (this._observers) {
      for (let i = 0; i < this._observers.length; i++) {
        notify(this._observers[i], STATE_DIRTY);
      }
    }
  }

  return this._value;
}

const OwnerNode = function Owner(this: Owner) {
  this._parent = null;
  this._nextSibling = null;
  this._prevSibling = null;
  if (currentOwner) currentOwner.append(this);
};

const OwnerProto = OwnerNode.prototype;
OwnerProto._context = null;
OwnerProto._compute = null;
OwnerProto._disposal = null;

OwnerProto.append = function appendChild(owner: Owner) {
  owner._parent = this;
  owner._prevSibling = this;
  if (this._nextSibling) this._nextSibling._prevSibling = owner;
  owner._nextSibling = this._nextSibling;
  this._nextSibling = owner;
};

/** @internal */
export function createOwner() {
  return new OwnerNode();
}

const ComputeNode = function Computation(
  this: Computation,
  initialValue,
  compute,
  options?: MemoOptions<any, any>
) {
  OwnerNode.call(this);

  this._state = compute ? STATE_DIRTY : STATE_CLEAN;
  this._init = false;
  this._effect = false;
  this._sources = null;
  this._observers = null;
  this._value = initialValue;

  if (compute) this._compute = compute;
  if (__DEV__) this.name = options?.name ?? (this._compute ? "computed" : "signal");
  if (options && options.equals !== undefined) this._equals = options.equals;
};

const ComputeProto: Computation = ComputeNode.prototype;
Object.setPrototypeOf(ComputeProto, OwnerProto);
ComputeProto._equals = isEqual;
ComputeProto.call = read;

/** @internal */
export function createComputation<T>(
  initialValue: T | undefined,
  compute: (() => T) | null,
  options?: MemoOptions<T>
): Computation<T> {
  return new ComputeNode(initialValue, compute, options);
}

export function isEqual(a: unknown, b: unknown) {
  return a === b;
}

export function isFunction(value: unknown): value is Function {
  return typeof value === "function";
}

function updateIfNecessary(node: Computation) {
  if (node._state === STATE_CHECK) {
    for (let i = 0; i < node._sources!.length; i++) {
      updateIfNecessary(node._sources![i]);
      if ((node._state as number) === STATE_DIRTY) {
        // Stop the loop here so we won't trigger updates on other parents unnecessarily
        // If our computation changes to no longer use some sources, we don't
        // want to update() a source we used last time, but now don't use.
        break;
      }
    }
  }

  if (node._state === STATE_DIRTY) update(node);
  else node._state = STATE_CLEAN;
}

function cleanup(node: Computation) {
  if (node._nextSibling && node._nextSibling._parent === node)
    dispose.call(node, false);
  if (node._disposal) emptyDisposal(node);
  node._context = null;
}

export function update(node: Computation) {
  let prevObservers = currentObservers,
    prevObserversIndex = currentObserversIndex;

  currentObservers = null as Computation[] | null;
  currentObserversIndex = 0;

  try {
    cleanup(node);

    const result = compute(node, node._compute!, node);

    if (currentObservers) {
      if (node._sources) removeSourceObservers(node, currentObserversIndex);

      if (node._sources && currentObserversIndex > 0) {
        node._sources.length = currentObserversIndex + currentObservers.length;
        for (let i = 0; i < currentObservers.length; i++) {
          node._sources[currentObserversIndex + i] = currentObservers[i];
        }
      } else {
        node._sources = currentObservers;
      }

      let source: Computation;
      for (let i = currentObserversIndex; i < node._sources.length; i++) {
        source = node._sources[i];
        if (!source._observers) source._observers = [node];
        else source._observers.push(node);
      }
    } else if (node._sources && currentObserversIndex < node._sources.length) {
      removeSourceObservers(node, currentObserversIndex);
      node._sources.length = currentObserversIndex;
    }

    if (!node._effect && node._init) {
      write.call(node, result);
    } else {
      node._value = result;
      node._init = true;
    }
  } catch (error) {
    if (
      __DEV__ &&
      !__TEST__ &&
      !node._init &&
      typeof node._value === "undefined"
    ) {
      console.error(
        `computed \`${node.name}\` threw error during first run, this can be fatal.` +
          "\n\nSolutions:\n\n" +
          "1. Set the `initial` option to silence this error",
        "\n2. Or, use an `effect` if the return value is not being used",
        "\n\n",
        error
      );
    }

    handleError(node, error);

    if (node._state === STATE_DIRTY) {
      cleanup(node);
      if (node._sources) removeSourceObservers(node, 0);
    }

    return;
  }

  currentObservers = prevObservers;
  currentObserversIndex = prevObserversIndex;

  node._state = STATE_CLEAN;
}

export function notify(node: Computation, state: number) {
  if (node._state >= state) return;

  if (node._effect && node._state === STATE_CLEAN) {
    effects.push(node);
    if (!scheduledEffects) flushEffects();
  }

  node._state = state;
  if (node._observers) {
    for (let i = 0; i < node._observers.length; i++) {
      notify(node._observers[i], STATE_CHECK);
    }
  }
}

function removeSourceObservers(node: Computation, index: number) {
  let source: Computation, swap: number;
  for (let i = index; i < node._sources!.length; i++) {
    source = node._sources![i];
    if (source._observers) {
      swap = source._observers.indexOf(node);
      source._observers[swap] = source._observers[source._observers.length - 1];
      source._observers.pop();
    }
  }
}
