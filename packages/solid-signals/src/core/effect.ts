import {
  EFFECT_RENDER,
  EFFECT_USER,
  REACTIVE_DISPOSED,
  STATUS_ERROR,
  STATUS_PENDING
} from "./constants.js";
import {
  computed,
  onCleanup,
  recompute,
  staleValues,
  type Computed,
  type Owner,
  type SignalOptions
} from "./core.js";

export interface Effect<T> extends Computed<T>, Owner {
  _effectFn: (val: T, prev: T | undefined) => void | (() => void);
  _errorFn?: (err: unknown, cleanup: () => void) => void;
  _cleanup?: () => void;
  _modified: boolean;
  _prevValue: T | undefined;
  _type: number;
}

/**
 * Effects are the leaf nodes of our reactive graph. When their sources change, they are
 * automatically added to the queue of effects to re-execute, which will cause them to fetch their
 * sources and recompute
 */
export function effect<T>(
  compute: (prev: T | undefined) => T,
  effect: (val: T, prev: T | undefined) => void | (() => void),
  error?: (err: unknown, cleanup: () => void) => void | (() => void),
  initialValue?: T,
  options?: SignalOptions<any> & { render?: boolean; defer?: boolean }
): void {
  let initialized = false;
  const node = computed<T>(
    options?.render ? p => staleValues(() => compute(p)) : compute,
    initialValue,
    {
      ...options,
      equals: () => {
        node._modified = !node._error;
        if (initialized) node._queue.enqueue(node._type, runEffect.bind(node));
        return false;
      },
      lazy: true
    }
  ) as Effect<T>;
  node._prevValue = initialValue;
  node._effectFn = effect;
  node._errorFn = error;
  node._cleanup = undefined;
  node._type = options?.render ? EFFECT_RENDER : EFFECT_USER;
  node._notifyStatus = () => {
    if (node._statusFlags & STATUS_ERROR) {
      let error = node._error;
      node._queue.notify(node, STATUS_PENDING, 0);
      if (node._type === EFFECT_USER) {
        try {
          return node._errorFn
            ? node._errorFn(error, () => {
                node._cleanup?.();
                node._cleanup = undefined;
              })
            : console.error(error);
        } catch (e) {
          error = e;
        }
      }
      if (!node._queue.notify(node, STATUS_ERROR, STATUS_ERROR)) throw error;
    } else if (node._type === EFFECT_RENDER)
      node._queue.notify(node, STATUS_PENDING | STATUS_ERROR, node._statusFlags);
  };
  recompute(node, true);
  !options?.defer &&
    (node._type === EFFECT_USER
      ? node._queue.enqueue(node._type, runEffect.bind(node))
      : runEffect.call(node));
  initialized = true;
  onCleanup(() => node._cleanup?.());
  if (__DEV__ && !node._parent)
    console.warn("Effects created outside a reactive context will never be disposed");
}

function runEffect(this: Effect<any>) {
  if (!this._modified || this._flags & REACTIVE_DISPOSED) return;
  this._cleanup?.();
  this._cleanup = undefined;
  try {
    this._cleanup = this._effectFn(this._value, this._prevValue) as any;
  } catch (error) {
    if (!this._queue.notify(this, STATUS_ERROR, STATUS_ERROR)) throw error;
  } finally {
    this._prevValue = this._value;
    this._modified = false;
  }
}
