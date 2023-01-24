export interface Computation<T = any> extends Owner {
  id?: string | undefined;

  /** @internal */
  _effect: boolean;
  /** @internal */
  _init: boolean;

  /** @internal */
  _value: T;
  /** @internal */
  _sources: Computation[] | null;
  /** @internal */
  _observers: Computation[] | null;

  /** @internal */
  _compute: (() => T) | null;
  /** @internal */
  _changed: (prev: T, next: T) => boolean;
  /** read */
  call(this: Computation<T>): T;
}

export interface ReadSignal<T> {
  (): T;
}

export interface SignalOptions<T> {
  id?: string;
  dirty?: (prev: T, next: T) => boolean;
}

export interface MemoOptions<T, R = never> extends SignalOptions<T> {
  initial?: R;
}

export type InferSignalValue<T> = T extends ReadSignal<infer R> ? R : T;

export interface WriteSignal<T> {
  (value: T | NextValue<T>): T;
}

export type SignalTuple<T> = [read: ReadSignal<T>, write: WriteSignal<T>];

export interface NextValue<T> {
  (prevValue: T): T;
}

export interface Owner {
  _parent: Owner | null;
  /** @internal */
  _state: number;
  /** @internal */
  _compute: unknown;
  /** @internal */
  _prevSibling: Owner | null;
  /** @internal */
  _nextSibling: Owner | null;
  /** @internal */
  _context: ContextRecord | null;
  /** @internal */
  _disposal: Disposable | Disposable[] | null;
  append(owner: Owner): void;
}

export interface Dispose {
  (): void;
}

export interface Disposable extends Callable {}

export interface Effect {
  (): MaybeStopEffect;
}

export interface StopEffect {
  (): void;
}

export interface Callable<This = unknown, Return = void> {
  call($this: This): Return;
}

export type Maybe<T> = T | void | null | undefined | false;
export type MaybeFunction = Maybe<(...args: any) => any>;
export type MaybeDisposable = Maybe<Disposable>;
export type MaybeStopEffect = Maybe<StopEffect>;
export type MaybeSignal<T> = MaybeFunction | ReadSignal<T>;
export type ContextRecord = Record<string | symbol, unknown>;
