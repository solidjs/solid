export interface Computation<T = any> extends Owner {
  name?: string | undefined;

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
  _equals: ((prev: T, next: T) => boolean) | false;
  /** read */
  call(this: Computation<T>): T;
}

export interface Accessor<T> {
  (): T;
}

export interface SignalOptions<T> {
  name?: string;
  equals?: ((prev: T, next: T) => boolean) | false;
}

export interface MemoOptions<T, R = never> extends SignalOptions<T> {
  initial?: R;
}

export type InferSignalValue<T> = T extends Accessor<infer R> ? R : T;

export interface Setter<T> {
  (value: T | NextValue<T>): T;
}

export interface NextValue<T> {
  (prevValue: T): T;
}

export type Signal<T> = [read: Accessor<T>, write: Setter<T>];

export interface SelectorSignal<T> {
  (key: T): Boolean;
}

export interface SelectorOptions<Key, Value> {
  name?: string;
  equals?: (key: Key, value: Value | undefined) => boolean;
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

export interface Callable<This = unknown, Return = void> {
  call($this: This, prev?: Return): Return;
}

export type Maybe<T> = T | void | null | undefined | false;
export type MaybeFunction = Maybe<(...args: any) => any>;
export type MaybeDisposable = Maybe<Disposable>;
export type MaybeSignal<T> = MaybeFunction | Accessor<T>;
export type ContextRecord = Record<string | symbol, unknown>;
