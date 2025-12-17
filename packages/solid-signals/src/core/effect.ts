import {
  EFFECT_RENDER,
  EFFECT_USER,
  REACTIVE_DISPOSED,
  STATUS_ERROR,
  STATUS_PENDING
} from "./constants.js";
import {
  computed,
  getOwner,
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
      _type: options?.render ? EFFECT_RENDER : EFFECT_USER,
      _notifyQueue(this: Effect<T>, statusFlagsChanged: boolean, prevStatusFlags: number) {
        if (initialized) {
          const errorChanged =
            this._statusFlags && this._statusFlags === prevStatusFlags && statusFlagsChanged;
          this._modified =
            !(this._statusFlags & STATUS_ERROR) &&
            !(this._statusFlags & STATUS_PENDING & ~prevStatusFlags) &&
            !errorChanged;
          if (this._modified) this._queue.enqueue(this._type, runEffect.bind(this));
        }

        if (this._statusFlags & STATUS_ERROR) {
          let error = this._error;
          this._queue.notify(this, STATUS_PENDING, 0);
          if (this._type === EFFECT_USER) {
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
          if (!this._queue.notify(this, STATUS_ERROR, STATUS_ERROR)) throw error;
        } else if ((this as any)._type === EFFECT_RENDER) {
          (this as any)._queue.notify(
            this,
            STATUS_PENDING | STATUS_ERROR,
            (this as any)._statusFlags
          );
        }
      }
    }
  } as any) as Effect<T>;
  initialized = true;
  if (node._type === EFFECT_RENDER) node._fn = p => staleValues(() => compute(p));
  !options?.defer &&
    !(node._statusFlags & (STATUS_ERROR | STATUS_PENDING)) &&
    (node._type === EFFECT_USER
      ? node._queue.enqueue(node._type, runEffect.bind(node))
      : runEffect.call(node));
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
