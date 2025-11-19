import { EffectType, StatusFlags } from "./constants.js";
import {
  computed,
  getOwner,
  isEqual,
  onCleanup,
  staleValues,
  type Computed,
  type Owner,
  type SignalOptions
} from "./core.js";
import { globalQueue } from "./scheduler.js";

interface Effect<T> extends Computed<T>, Owner {
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
  const node = computed<T>(compute, initialValue, {
    ...options,
    _forceRun: true,
    equals(prev, val) {
      const equal = isEqual(prev, val);
      if (initialized) {
        node._modified = !equal;
        if (!equal && !(node._statusFlags & StatusFlags.Error)) {
          node._queue.enqueue(node._type, runEffect.bind(node));
        }
      }
      return equal;
    },
    _internal: {
      _modified: false,
      _prevValue: initialValue,
      _effectFn: effect,
      _errorFn: error,
      _cleanup: undefined,
      _queue: getOwner()?._queue ?? globalQueue,
      _type: options?.render ? EffectType.Render : EffectType.User,
      _notifyQueue() {
        (this as any)._type === EffectType.Render &&
          (this as any)._queue.notify(this, StatusFlags.Pending | StatusFlags.Error, (this as any)._statusFlags);
      }
    },
  } as any) as Effect<T>;
  initialized = true;
  if (node._type === EffectType.Render) {
    node._fn = p =>
      !(node._statusFlags & StatusFlags.Error) ? staleValues(() => compute(p)) : compute(p);
  }
  !options?.defer &&
    !(node._statusFlags & (StatusFlags.Error | StatusFlags.Pending)) &&
    (node._type === EffectType.User
      ? node._queue.enqueue(node._type, runEffect.bind(node))
      : runEffect.call(node));
  onCleanup(() => node._cleanup?.());
  if (__DEV__ && !node._parent)
    console.warn("Effects created outside a reactive context will never be disposed");
}

function runEffect(this: Effect<any>) {
  if (!this._modified) return;
  this._cleanup?.();
  this._cleanup = undefined;
  try {
    this._cleanup = this._effectFn(this._value, this._prevValue) as any;
  } catch (error) {
    this._queue.notify(this, StatusFlags.Pending, 0);
    if (this._type === EffectType.User) {
      try {
        return this._errorFn
          ? this._errorFn(error, () => {
              this._cleanup?.();
              this._cleanup = undefined;
            })
          : console.error(error);
      } catch (e) {
        error = e;
      }
    }
    if (!this._queue.notify(this, StatusFlags.Error, StatusFlags.Error)) throw error;
  } finally {
    this._prevValue = this._value;
    this._modified = false;
  }
}
