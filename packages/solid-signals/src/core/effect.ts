import { EffectType, ReactiveFlags, StatusFlags } from "./constants.js";
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
  const node = computed<T>(compute, initialValue, {
    ...options,
    _internal: {
      _modified: true,
      _prevValue: initialValue,
      _effectFn: effect,
      _errorFn: error,
      _cleanup: undefined,
      _queue: getOwner()?._queue ?? globalQueue,
      _type: options?.render ? EffectType.Render : EffectType.User,
      _notifyQueue(this: Effect<T>, statusFlagsChanged: boolean, prevStatusFlags: number) {
        if (initialized) {
          const errorChanged =
            this._statusFlags && this._statusFlags === prevStatusFlags && statusFlagsChanged;
          this._modified =
            !(this._statusFlags & StatusFlags.Error) &&
            !(this._statusFlags & StatusFlags.Pending & ~prevStatusFlags) &&
            !errorChanged;
          if (this._modified) this._queue.enqueue(this._type, runEffect.bind(this));
        }

        if (this._statusFlags & StatusFlags.Error) {
          let error = this._error;
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
        } else if ((this as any)._type === EffectType.Render) {
          (this as any)._queue.notify(
            this,
            StatusFlags.Pending | StatusFlags.Error,
            (this as any)._statusFlags
          );
        }
      }
    }
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

export function runEffect(this: Effect<any>) {
  if (!this._modified || this._flags & ReactiveFlags.Disposed) return;
  this._cleanup?.();
  this._cleanup = undefined;
  try {
    this._cleanup = this._effectFn(this._value, this._prevValue) as any;
  } catch (error) {
    if (!this._queue.notify(this, StatusFlags.Error, StatusFlags.Error)) throw error;
  } finally {
    this._prevValue = this._value;
    this._modified = false;
  }
}
